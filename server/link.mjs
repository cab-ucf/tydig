// The link collaborators open: <TYDIG_PAGE>#<id>, tydig's static page plus
// the public id of a key only this hub holds. The page reaches the hub over
// iroh (irp's wasm client, github.com/cab-ucf/irp): no domain, certificate
// or open port. Each iroh stream is one HTTP/1.0 exchange, handed to the
// hub's HTTP server as a connection; websockets ride the bridge below.
import express from 'express'
import { Duplex } from 'node:stream'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'
import { DATA } from './store.mjs'
import { derive, newSeed, relayUrl, RELAYS } from './relay.mjs'

const PAGE = process.env.TYDIG_LINK === '0' ? '' : process.env.TYDIG_PAGE || 'https://cxn.pub/'
const PIN = process.env.TYDIG_LINK_RELAY
const ALPN = [...Buffer.from('irweb/http/1')]
const seedFile = path.join(DATA, 'link-seed')
if (PAGE && !existsSync(seedFile)) writeFileSync(seedFile, newSeed(randomBytes(16)) + '\n', { mode: 0o600 })
const secret = PAGE && [...derive(readFileSync(seedFile, 'utf8').trim(), 'irweb v1 endpoint identity')]
const iroh = PAGE && await import('@number0/iroh')
export const LINK = PAGE && `${PAGE}#${newSeed(iroh.SecretKey.fromBytes(secret).public().toBytes())}` +
  (PIN ? `;r=${PIN}` : '')
if (LINK) writeFileSync(path.join(DATA, 'link'), LINK + '\n', { mode: 0o600 })
export let online = false

export async function start(server) {
  if (!LINK) return
  const b = iroh.Endpoint.builder()
  b.applyMinimal(); b.secretKey(secret); b.alpns([ALPN])
  b.relayMode(iroh.RelayMode.customFromUrls(PIN ? [relayUrl(PIN)] : RELAYS))
  const ep = await b.bind()
  ;(async () => {
    for (let inc; (inc = await ep.acceptNext().catch(() => null));) (async () => {
      const conn = await (await inc.accept()).connect(), peer = conn.remoteId().toString()
      for (;;) serve(server, await conn.acceptBi(), peer)
    })().catch(() => {})
  })()
  const late = setTimeout(() => console.warn('link: no relay yet; the hub needs outbound HTTPS to its relay'), 20_000)
  await ep.online(); clearTimeout(late); online = true
  console.log(`link: online, ${LINK}`)
}

// The browser half-closes after its request; that end is never passed on,
// or Node's server would drop the reply.
function serve(server, { send, recv }, peer) {
  const d = new Duplex({
    read() { recv.read(64 << 10).then(c => c?.length && this.push(Buffer.from(c)), e => this.destroy(e)) },
    write(c, _, cb) { send.writeAll([...c]).then(() => cb(), cb) },
    final(cb) { send.finish().finally(() => { cb(); this.destroy() }) },
    destroy(e, cb) { send.finish().catch(() => {}); cb(e) },
  })
  d.link = true // only our page speaks on these: they count as the hub's origin
  // its own sign-in rate limit: a private IPv6 address per iroh id
  d.ip = (h => `fd${h.slice(0, 2)}:${h.slice(2, 14).match(/.{4}/g).join(':')}::1`)(
    createHash('sha256').update(peer).digest('hex'))
  server.emit('connection', d)
}

// Websockets for link visitors: a GET opens one to /sync or /lsp and streams
// its messages down as [type u8][length u32][bytes]; each POST sends one up.
const bridges = new Map()
export const bridge = port => express.Router()
  .get('/bridge', (req, res) => {
    const { path: to = '', id = '' } = req.query
    if (!/^\/(sync|lsp)\b/.test(to) || !/^\w{16,64}$/.test(id) || bridges.has(id)) return res.sendStatus(400)
    const ws = new WebSocket(`ws://127.0.0.1:${port}${to}`, { headers: { cookie: req.headers.cookie || '', origin: req.headers.origin } })
    const frame = (type, d) => {
      if (res.writableEnded) return
      const h = Buffer.alloc(5); h[0] = type; h.writeUInt32BE(d.length, 1); res.write(Buffer.concat([h, d]))
    }
    bridges.set(id, { ws, user: req.user.id })
    ws.on('open', () => res.writeHead(200, { 'content-type': 'application/octet-stream' }).flushHeaders())
    ws.on('message', (d, binary) => frame(binary ? 2 : 1, Buffer.from(d)))
    ws.on('error', () => res.headersSent || res.sendStatus(502))
    ws.on('close', () => res.end())
    res.on('error', () => ws.terminate())
    res.on('close', () => { ws.terminate(); bridges.delete(id) })
  })
  .post('/bridge/:id', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
    const b = bridges.get(req.params.id)
    if (b?.user !== req.user.id) return res.sendStatus(404)
    b.ws.send(req.body ?? Buffer.alloc(0), { binary: req.get('x-binary') === '1' })
    res.sendStatus(204)
  })
