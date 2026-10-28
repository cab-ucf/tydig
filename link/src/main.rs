//! The hub's end of its link (server/link.mjs): each iroh stream a page
//! opens goes onto the hub's socket as it is, after the peer's 32-byte id,
//! its bytes never through JavaScript.
//!   tydig-link SOCKET RELAY...   stdin: the 32-byte secret key, then held
//!   open (the hub gone, so is this)

use std::{future::pending, io::Read, sync::Arc, time::Duration};

use iroh::{
    Endpoint, EndpointId, RelayMode, RelayUrl, SecretKey,
    endpoint::{Incoming, RecvStream, SendStream, presets},
};
use tokio::{
    io::{self, AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    sync::{OwnedSemaphorePermit, Semaphore},
};

const ALPN: &[u8] = b"irweb/http/1";
/// Streams in flight, from everyone: anyone with the link may open them.
const MAX: usize = 256;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let sock: Arc<str> = args
        .next()
        .ok_or("usage: tydig-link SOCKET RELAY...")?
        .into();
    let relays: Vec<RelayUrl> = args.map(|r| r.parse()).collect::<Result<_, _>>()?;
    let mut key = [0; 32];
    std::io::stdin().read_exact(&mut key)?;
    std::thread::spawn(|| {
        let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
        std::process::exit(0)
    });
    // Relays in order, not the nearest: the dedicated one pings slower but
    // moves more. The page dials them all, so wherever this lands it is found.
    let mut ep = None;
    for (i, r) in relays.iter().enumerate() {
        let e = Endpoint::builder(presets::Minimal)
            .secret_key(SecretKey::from_bytes(&key))
            .alpns(vec![ALPN.to_vec()])
            .relay_mode(RelayMode::custom([r.clone()]))
            .bind()
            .await?;
        let last = i + 1 == relays.len();
        if last
            || tokio::time::timeout(Duration::from_secs(10), e.online())
                .await
                .is_ok()
        {
            ep = Some(e);
            break;
        }
        e.close().await;
    }
    let ep = ep.ok_or("no relay")?;
    let on = ep.clone();
    tokio::spawn(async move {
        on.online().await;
        println!("online");
    });
    let cap = Arc::new(Semaphore::new(MAX));
    while let Some(inc) = ep.accept().await {
        tokio::spawn(connection(inc, sock.clone(), cap.clone()));
    }
    Ok(())
}

async fn connection(inc: Incoming, sock: Arc<str>, cap: Arc<Semaphore>) {
    let Ok(conn) = inc.await else { return };
    let peer = conn.remote_id();
    while let Ok((send, recv)) = conn.accept_bi().await {
        let Ok(permit) = cap.clone().acquire_owned().await else {
            return;
        };
        tokio::spawn(stream(send, recv, sock.clone(), peer, permit));
    }
}

async fn stream(
    mut send: SendStream,
    mut recv: RecvStream,
    sock: Arc<str>,
    peer: EndpointId,
    _permit: OwnedSemaphorePermit,
) {
    let Ok(hub) = UnixStream::connect(&*sock).await else {
        return;
    };
    let (mut r, mut w) = hub.into_split();
    // The hub nods once it has the id, so nothing else waits in its buffers
    // when it hands the socket to its HTTP server.
    let mut nod = [0];
    if w.write_all(peer.as_bytes()).await.is_err() || r.read_exact(&mut nod).await.is_err() {
        return;
    }
    // The page half-closes after its request: that end is never passed on,
    // or the hub would drop its answer.
    let up = async {
        if io::copy(&mut recv, &mut w).await.is_ok() {
            pending::<()>().await
        }
    };
    let down = async {
        let _ = io::copy(&mut r, &mut send).await;
        let _ = send.finish();
    };
    tokio::select! { () = up => {}, () = down => {} }
}
