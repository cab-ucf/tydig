// tydig in a window of its own: a start page (ui/) that asks which hub,
// then the hub's own page, as a browser would load it. The hub stays the
// one source of the editor; this holds no copy. Only the start page may
// call in here (capabilities/: no remote URL), and the window goes only
// where it was sent: the hubs opened, and their sign-in's provider.
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

/// The hub that answers when a code comes with no address.
const SITE: &str = "cxn.pub";
/// Where the start page is served from.
const HOME: &str = if cfg!(any(windows, target_os = "android")) {
    "http://tauri.localhost/"
} else {
    "tauri://localhost/"
};
/// The hubs opened, by origin; http(s) only, so never an opaque "null".
static HUBS: Mutex<Vec<String>> = Mutex::new(Vec::new());
fn origin(u: &Url) -> String {
    u.origin().ascii_serialization()
}

/// What people type, or a tydig:// link carries: a hub's address or link,
/// or the words said aloud ("cxn.pub, code tidy ruby otter").
fn hub(s: &str) -> Option<Url> {
    let s = s.trim();
    let s = s.strip_prefix("tydig:").unwrap_or(s);
    let s = s.strip_prefix("//").unwrap_or(s);
    let mut w = s.split([' ', '\t', '\n', ',']).filter(|w| !w.is_empty());
    let first = w.next()?;
    let at = first.contains(['.', ':', '/', '#', ';']) || first == "localhost";
    let words: Vec<_> = (!at).then_some(first).into_iter().chain(w).collect();
    let a = if at { first } else { SITE };
    let a = if a.contains("://") {
        a.to_string()
    } else if !a.contains(['.', ':', '/']) && a != "localhost" {
        format!("https://{SITE}/#{}", a.trim_start_matches('#')) // its iroh id
    } else {
        let h = a.split(['/', '?', '#']).next()?;
        let h = h.rsplit_once(':').filter(|_| !h.ends_with(']'));
        let h = h.map_or(a, |h| h.0);
        let local = h == "localhost"
            || h.starts_with('[')
            || h.parse::<std::net::IpAddr>().is_ok();
        format!("{}://{a}", if local { "http" } else { "https" })
    };
    let mut u = Url::parse(&a).ok()?;
    if !matches!(u.scheme(), "http" | "https") || u.host().is_none() {
        return None;
    }
    let code: Vec<_> = words
        .into_iter()
        .filter(|w| !w.eq_ignore_ascii_case("code"))
        .collect();
    if code
        .iter()
        .any(|w| !w.bytes().all(|b| b.is_ascii_alphabetic()))
    {
        return None;
    }
    if !code.is_empty() {
        u.query_pairs_mut()
            .append_pair("join", &code.join("-").to_lowercase());
    }
    Some(u)
}

/// The start page's one call: where to go, once something answers there.
#[tauri::command(async)]
fn open(input: String) -> Result<String, String> {
    let u = hub(&input).ok_or("Not a hub's address, link or code.")?;
    let t = Duration::from_secs(5);
    let up = u.socket_addrs(|| None).is_ok_and(|a| {
        a.iter().any(|a| TcpStream::connect_timeout(a, t).is_ok())
    });
    if !up {
        let h = u.authority();
        return Err(format!("{h} does not answer: is this device online?"));
    }
    HUBS.lock().unwrap().push(origin(&u));
    Ok(u.into())
}

/// The start page's.
fn local(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

/// The start page, the hubs opened, and an identity provider a hub sent
/// its sign-in to (it names the hub to come back to).
fn allowed(u: &Url) -> bool {
    if local(u) {
        return true;
    }
    let (mut hubs, o) = (HUBS.lock().unwrap(), origin(u));
    let back = u.query_pairs().any(|(k, v)| {
        k == "redirect_uri"
            && Url::parse(&v).is_ok_and(|r| hubs.contains(&origin(&r)))
    });
    if back && u.scheme() == "https" && !hubs.contains(&o) {
        hubs.push(o.clone());
    }
    hubs.contains(&o)
}

/// Anywhere else is the browser's.
fn away(app: &AppHandle, u: &Url) {
    if matches!(u.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(u.as_str(), None::<&str>);
    }
}

/// Back to the start page; with a link, filled in to be opened.
fn start(app: &AppHandle, link: Option<&str>) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let mut u = Url::parse(HOME).unwrap();
    if let Some(l) = link {
        u.query_pairs_mut().append_pair("open", l);
    }
    let _ = (w.navigate(u), w.show(), w.set_focus());
}

#[cfg(desktop)]
fn menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, Submenu};
    let h = app.handle();
    let hubs =
        MenuItem::with_id(h, "hubs", "Hubs", true, Some("CmdOrCtrl+Shift+H"))?;
    // macOS keeps its own (Edit's copy and paste live there)
    let m = if cfg!(target_os = "macos") {
        Menu::default(h)?
    } else {
        Menu::new(h)?
    };
    m.append(&Submenu::with_items(h, "Hub", true, &[&hubs])?)?;
    app.set_menu(m)?;
    app.on_menu_event(|a, e| {
        if e.id() == "hubs" {
            start(a, None)
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let b = tauri::Builder::default();
    // One window: a second launch hands its link to the first.
    #[cfg(desktop)]
    let b = b.plugin(tauri_plugin_single_instance::init(|a, _, _| {
        a.get_webview_window("main").map(|w| w.set_focus());
    }));
    b.plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open])
        .setup(|app| {
            let (h, n) = (app.handle().clone(), app.handle().clone());
            let w =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .on_navigation(move |u| {
                        allowed(u) || (away(&h, u), false).1
                    })
                    .on_new_window(move |u, _| {
                        (away(&n, &u), NewWindowResponse::Deny).1
                    })
                    .on_download(|_, _| true); // to Downloads
            // which hub this is, beside its page's title: no address bar
            #[cfg(desktop)]
            let w = w
                .title("tydig")
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 480.0)
                .on_document_title_changed(|w, t| {
                    let at = match w.url() {
                        _ if t.is_empty() => return, // between pages
                        Ok(u) if !local(&u) => {
                            format!("{t} · {}", u.authority())
                        }
                        _ => t,
                    };
                    let _ = w.set_title(&at);
                });
            w.build()?;
            #[cfg(desktop)]
            menu(app)?;
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            let _ = app.deep_link().register_all();
            let h = app.handle().clone();
            app.deep_link().on_open_url(move |e| {
                if let Some(u) = e.urls().first() {
                    start(&h, Some(u.as_str()))
                }
            });
            let now = app.deep_link().get_current().ok().flatten();
            if let Some(u) = now.as_deref().and_then(<[_]>::first) {
                start(app.handle(), Some(u.as_str()))
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tydig");
}

#[test]
fn hubs() {
    let h = |s| hub(s).map(String::from);
    let s = |s: &str| Some(s.to_string());
    assert_eq!(h("cxn.pub"), s("https://cxn.pub/"));
    assert_eq!(
        h("cxn.pub, code tidy ruby otter"),
        s("https://cxn.pub/?join=tidy-ruby-otter")
    );
    assert_eq!(
        h("Tidy Ruby Otter"),
        s("https://cxn.pub/?join=tidy-ruby-otter")
    );
    assert_eq!(
        h("https://cxn.pub/#ab2;t=00"),
        s("https://cxn.pub/#ab2;t=00")
    );
    assert_eq!(h("#ab2;t=00"), s("https://cxn.pub/#ab2;t=00"));
    assert_eq!(
        h("tydig://cxn.pub/#ab2;t=00"),
        s("https://cxn.pub/#ab2;t=00")
    );
    assert_eq!(h("localhost:8080"), s("http://localhost:8080/"));
    assert_eq!(
        h("10.0.0.2:3000 code a b c"),
        s("http://10.0.0.2:3000/?join=a-b-c")
    );
    assert_eq!(h("[::1]:8080"), s("http://[::1]:8080/"));
    assert_eq!(
        h("hub.example.edu:8443/x"),
        s("https://hub.example.edu:8443/x")
    );
    assert_eq!(h("file:///etc/passwd"), None);
    assert_eq!(h("javascript:alert(1)"), None);
    assert_eq!(h("cxn.pub code r00t"), None);
    assert_eq!(h(""), None);
}
