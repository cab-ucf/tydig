// Browser links: <TYDIG_PAGE>#<id>. The page is the tydig client on a static
// host plus irp's wasm iroh client (github.com/cab-ucf/irp). The id is the
// public half of the key this hub derives from its seed, as irp does: it can be
// published (a site's default hub), for it cannot pose as the hub. One HTTP/1.0
// exchange per stream. Each stream is handed to the hub's own HTTP server as a
// connection, so nothing behind it knows the difference. No domain, no TLS
// certificate, no open port: the hub can sit behind NAT on a laptop.
import { Duplex } from 'node:stream'
import { derive, newSeed } from './relay.mjs'
export { newSeed }

const ALPN = [...Buffer.from('irweb/http/1')], KEY = 'irweb v1 endpoint identity'
const secret = seed => [...derive(seed, KEY)]
export const hubId = async seed =>
  newSeed((await import('@number0/iroh')).SecretKey.fromBytes(secret(seed)).public().toBytes())

export async function startLink({ server, seed, relay }) {
  const iroh = await import('@number0/iroh')
  const b = iroh.Endpoint.builder()
  b.applyMinimal()
  b.secretKey(secret(seed))
  b.relayMode(iroh.RelayMode.customFromUrls([relay]))
  b.alpns([ALPN])
  const ep = await b.bind()
  ;(async () => {
    for (let inc; (inc = await ep.acceptNext().catch(() => null));)
      (async () => {
        const conn = await (await inc.accept()).connect(), peer = conn.remoteId().toString()
        for (;;) serve(server, await conn.acceptBi(), peer)
      })().catch(() => {})
  })()
  return { close: () => ep.close().catch(() => {}), online: () => ep.online() }
}

function serve(server, { send, recv }, peer) {
  // The browser half-closes after its request; Node's HTTP server would take
  // that end of input as a hang-up and drop the reply. So the end is never
  // passed on: the server answers, ends its side, and the stream closes then.
  const d = new Duplex({
    read() {
      recv.read(64 << 10).then(c => c?.length && this.push(Buffer.from(c)), e => this.destroy(e))
    },
    write(c, _, cb) { send.writeAll([...c]).then(() => cb(), cb) },
    final(cb) { send.finish().finally(() => { cb(); this.destroy() }) },
    destroy(e, cb) { send.finish().catch(() => {}); cb(e) },
  })
  d.link = true // index.mjs: only our page can speak on these, so they need no origin check
  d.peer = peer // the browser's iroh id: its own sign-in rate limit, not one shared by every visitor
  server.emit('connection', d)
}
