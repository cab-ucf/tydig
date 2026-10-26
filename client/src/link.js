// Link mode: this page came from tydig's static site as <page>#<hub id>, not
// from a hub; with no #, the site's own hub (VITE_HUB, set where it is built).
// The code is the hub's public id with its access token (<id>;t=<token>),
// or an older link's seed, which gives both. What the app sends
// to /api, and the websockets it opens to /sync and /lsp, go to the hub over
// iroh instead, through irp's wasm client (public/irweb, built from
// github.com/cab-ucf/irp web/); server/link.mjs is the far end.
// Imported first, so everything after sees the patched fetch and WebSocket.
import { ed25519 } from '@noble/curves/ed25519.js'
import { RELAYS, relayUrl, derive, newSeed } from '../../server/relay.mjs'
const HUB = import.meta.env.VITE_HUB
const code = /^#([a-z2-7]{26}|[a-z2-7]{52};t=[0-9a-f]{64})(?:;r=(\S+))?$/
// A site with its own hub opens that hub alone: on one origin every hub's
// sign-in looks alike, so a link to another would get your password filled in.
const m = HUB ? code.exec('#' + HUB) : code.exec(location.hash)
if (HUB && code.exec(location.hash)?.[1] !== m?.[1]) history.replaceState(null, '', location.pathname + location.search)
const pin = m?.[2] && relayUrl(decodeURIComponent(m[2]))
// id: the hub's public id, a seed's as an older link's, so no other hub can
// share this one's cookies or drafts, and neither seed nor token is stored
const idOf = c => c.length > 26 ? c.split(';')[0]
  : newSeed(ed25519.getPublicKey(derive(c, 'irweb v1 endpoint identity')))
export const link = m && { code: m[1], pin, relays: pin ? [pin] : RELAYS, id: idOf(m[1]) }
// the site's own hub, at the bare address (cxn.pub): links to it need no code
export const plain = !!HUB && !location.hash

// What the visitor sees until the hub answers: never a silent, frozen page.
const say = (html, fail) => {
  const el = document.getElementById('link-status') ??
    document.body.appendChild(Object.assign(document.createElement('div'), { id: 'link-status' }))
  el.className = fail ? 'fail' : ''; el.innerHTML = html
  el.querySelector('button')?.addEventListener('click', () => location.reload())
}
// Why a link fails, found by asking each relay directly: an HTTPS ping, then
// the WebSocket iroh needs (2 = both work). Relays refuse Firefox's TLS hello
// when it carries ECH GREASE, the ping too, so in Firefox that comes first.
const NativeWS = WebSocket
const probe = async r => {
  r = r.replace(/\/?$/, '/')
  const ping = await fetch(r + 'ping', { cache: 'no-store' }).then(x => x.ok, () => false)
  return ping && await new Promise(ok => {
    const w = new NativeWS(r.replace(/^http/, 'ws') + 'relay', ['iroh-relay-v1'])
    w.onopen = () => { w.close(); ok(2) }; w.onerror = () => ok(1); setTimeout(() => ok(1), 8000)
  })
}
async function why() {
  const best = Math.max(...await Promise.all(link.relays.map(probe)))
  const host = link.relays.map(r => new URL(r).host).join('</code> or <code>')
  const ping = best > 0, ws = best > 1
  if (!ws && /Firefox\//.test(navigator.userAgent)) return `The relay (<code>${host}</code>) may be
    refusing Firefox's connection. In <code>about:config</code> set
    <code>security.tls.ech.grease_probability</code> to 0, or open this link in Chrome, Edge or Safari.
    If those fail too, this network blocks the relay: try another network or a phone hotspot.`
  if (!ping) return `This network does not reach the relay (<code>${host}</code>): a firewall or
    filter is blocking it. Try another network, a phone hotspot or a VPN.`
  if (!ws) return `The relay answers, but this network or browser blocks its WebSocket (a proxy,
    filter or extension). Try another network or browser.`
  if (plain) return 'The hub is off or restarting: try again in a minute.'
  return `The relay works from here, so the hub is not on it: is it running, and does its log say
    <code>link: online</code>? Is this its current link (<code>just link</code> prints it)?`
}
let client
const connect = () => client ??= new Promise((ok, no) => {
  say('Connecting to the hub&hellip;')
  const at = f => new URL('irweb/' + f, document.baseURI).href
  const s = Object.assign(document.createElement('script'), { src: at('irweb_web.js'), onerror: no })
  s.onload = () => wasm_bindgen({ module_or_path: at('irweb_web_bg.wasm') })
    .then(() => wasm_bindgen.Client.connect(link.code + (link.pin ? `;r=${link.pin}` : '')))
    .then(ok, no)
  setTimeout(() => no(new Error('no answer in 30 s')), 30_000)
  document.head.append(s)
}).then(c => { document.getElementById('link-status')?.remove(); return c }, e => {
  client = null
  say('Could not reach the hub; checking why&hellip;', true)
  why().then(w => say(`<b>Could not reach the hub</b> (${String(e?.message || e).replace(/[<&]/g, '')}).<br>
    ${w} <button>try again</button>`, true))
  throw e
})

// The hub's cookies: a page cannot hold another origin's, so it keeps its own jar.
const JAR = link && `tydig.jar:${link.id}`
const jar = new Map(link ? Object.entries(JSON.parse(localStorage[JAR] || '{}')) : [])
const keep = c => {
  const [kv, ...attrs] = c.split(';'), i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim()
  ;/max-age=0\b/i.test(attrs.join(';')) || !v ? jar.delete(k) : jar.set(k, v)
  localStorage[JAR] = JSON.stringify(Object.fromEntries(jar))
}

async function hubFetch(req) {
  const c = await connect(), u = new URL(req.url)
  let h = jar.size ? `cookie: ${[...jar].map(kv => kv.join('=')).join('; ')}\r\n` : ''
  for (const [k, v] of req.headers) h += `${k}: ${v}\r\n`
  const body = /^(GET|HEAD)$/.test(req.method) ? undefined : new Uint8Array(await req.arrayBuffer())
  const r = await c.fetch(req.method, u.pathname + u.search, h, body), out = new Headers(), l = r.headers.split('\n')
  for (let i = 0; i + 1 < l.length; i += 2) /^set-cookie$/i.test(l[i]) ? keep(l[i + 1]) : out.append(l[i], l[i + 1])
  const empty = req.method === 'HEAD' || [101, 204, 205, 304].includes(r.status)
  return new Response(empty ? null : r.body, { status: r.status === 101 ? 200 : r.status, headers: out })
}

// [type u8][length u32][bytes] off a stream, in a buffer that grows by
// doubling: each byte copied a bounded number of times, however it arrives
async function* frames(rd) {
  let buf = new Uint8Array(1 << 16), len = 0, at = 0
  for (;;) {
    for (let n; len - at >= 5 && len - at >= 5 + (n = new DataView(buf.buffer).getUint32(at + 1)); at += 5 + n)
      yield [buf[at], buf.slice(at + 5, at + 5 + n)]
    const { value, done } = await rd.read()
    if (done) return
    if (at) buf.copyWithin(0, at, len), len -= at, at = 0
    if (len + value.length > buf.length) { const t = new Uint8Array(2 * (len + value.length)); t.set(buf.subarray(0, len)); buf = t }
    buf.set(value, len); len += value.length
  }
}

// Same API as a browser WebSocket, carried by /api/bridge (see server/link.mjs).
class HubSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0; binaryType = 'blob'; protocol = ''; extensions = ''; bufferedAmount = 0
  onopen = null; onmessage = null; onclose = null; onerror = null
  #id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
  #sent = Promise.resolve(); #reader = null
  constructor(url) { super(); this.url = String(url); this.#run(new URL(url)) }
  #emit(type, init) {
    const e = type === 'message' ? new MessageEvent(type, init)
      : type === 'close' ? new CloseEvent(type, init) : new Event(type)
    this['on' + type]?.(e); this.dispatchEvent(e)
  }
  async #run(u) {
    try {
      const r = await fetch(`/api/bridge?id=${this.#id}&path=${encodeURIComponent(u.pathname + u.search)}`)
      if (!r.ok) throw new Error(r.status)
      if (this.readyState) { // closed while connecting
        r.body?.cancel(); this.readyState = 3
        return this.#emit('close', { code: 1000 })
      }
      this.#reader = r.body.getReader(); this.readyState = 1; this.#emit('open')
      for await (const [type, d] of frames(this.#reader))
        this.#emit('message', { data: type === 1 ? new TextDecoder().decode(d)
          : this.binaryType === 'arraybuffer' ? d.buffer : new Blob([d]) })
    } catch { if (this.readyState === 0) this.#emit('error') }
    this.readyState = 3; this.#emit('close', { code: 1006 })
  }
  send(d) {
    const binary = typeof d === 'string' ? '0' : '1'
    this.#sent = this.#sent.then(() => fetch(`/api/bridge/${this.#id}`,
      { method: 'POST', headers: { 'x-binary': binary }, body: d })).catch(() => {})
  }
  close() { if (this.readyState < 2) { this.readyState = 2; this.#reader?.cancel() } }
}

if (link) {
  const native = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input, init) => {
    const req = new Request(input, init), u = new URL(req.url)
    return u.origin === location.origin && u.pathname.startsWith('/api/') ? hubFetch(req) : native(req)
  }
  // only the app's own sockets: the iroh client reaches its relay by WebSocket too
  globalThis.WebSocket = new Proxy(WebSocket, { construct: (WS, [url, p]) =>
    new URL(url, location.href).host === location.host ? new HubSocket(url) : new WS(url, p) })
}
