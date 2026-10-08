// Link mode: this page came from tydig's static site as <page>#<seed>, not from
// a hub. What the app sends to /api, and the websockets it opens to /sync and
// /lsp, go to the hub over iroh instead, through irp's wasm client
// (public/irweb, from github.com/cab-ucf/irp); server/link.mjs is the far end.
// Imported first, so everything after sees the patched fetch and WebSocket.
const m = /^#([a-z2-7]{26})(?:;r=(\S+))?$/.exec(location.hash)
export const link = m && { seed: m[1], relay: m[2] && decodeURIComponent(m[2]), id: m[1].slice(0, 8) }

// What the visitor sees until the hub answers: never a silent, frozen page.
const say = (html, fail) => {
  const el = document.getElementById('link-status') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'link-status' }))
  el.className = fail ? 'fail' : ''; el.innerHTML = html
  el.querySelector('button')?.addEventListener('click', () => location.reload())
}
let client
const connect = () => client ??= new Promise((ok, no) => {
  say('Connecting to the hub&hellip;')
  const at = f => new URL('irweb/' + f, document.baseURI).href
  const s = Object.assign(document.createElement('script'), { src: at('irweb_web.js'), onerror: no })
  s.onload = () => wasm_bindgen({ module_or_path: at('irweb_web_bg.wasm') })
    .then(() => wasm_bindgen.Client.connect(link.seed, link.relay)).then(ok, no)
  setTimeout(() => no(new Error('no answer in 30 s')), 30_000)
  document.head.append(s)
}).then(c => { document.getElementById('link-status')?.remove(); return c }, e => {
  client = null
  say(`<b>Could not reach the hub</b> (${String(e?.message || e).replace(/[<&]/g, '')}).<br>
    The hub must be running and online, and this link must be its current one
    (<code>just link</code> prints it). <button>try again</button>`, true)
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

// Same API as a browser WebSocket, carried by /api/bridge (see server/index.mjs).
class HubSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0; binaryType = 'blob'; protocol = ''; extensions = ''; bufferedAmount = 0
  onopen = null; onmessage = null; onclose = null; onerror = null
  #id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
  #sent = Promise.resolve(); #reader = null
  constructor(url) { super(); this.url = String(url); this.#run(new URL(url)) }
  #emit(type, init) {
    const e = type === 'message' ? new MessageEvent(type, init) : type === 'close' ? new CloseEvent(type, init) : new Event(type)
    this['on' + type]?.(e); this.dispatchEvent(e)
  }
  async #run(u) {
    try {
      const r = await fetch(`/api/bridge?id=${this.#id}&path=${encodeURIComponent(u.pathname + u.search)}`)
      if (!r.ok) throw new Error(r.status)
      if (this.readyState) { r.body?.cancel(); this.readyState = 3; return this.#emit('close', { code: 1000 }) } // closed while connecting
      this.#reader = r.body.getReader(); this.readyState = 1; this.#emit('open')
      for (let buf = new Uint8Array(0); ;) {
        const { value, done } = await this.#reader.read()
        if (done) break
        const t = new Uint8Array(buf.length + value.length); t.set(buf); t.set(value, buf.length); buf = t
        for (let n; buf.length >= 5 && buf.length >= 5 + (n = new DataView(buf.buffer).getUint32(1));) {
          const d = buf.slice(5, 5 + n), text = buf[0] === 1
          buf = buf.slice(5 + n)
          this.#emit('message', { data: text ? new TextDecoder().decode(d) : this.binaryType === 'arraybuffer' ? d.buffer : new Blob([d]) })
        }
      }
    } catch { if (this.readyState === 0) this.#emit('error') }
    this.readyState = 3; this.#emit('close', { code: 1006 })
  }
  send(d) {
    const binary = typeof d === 'string' ? '0' : '1'
    this.#sent = this.#sent.then(() => fetch(`/api/bridge/${this.#id}`, { method: 'POST', headers: { 'x-binary': binary }, body: d })).catch(() => {})
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
