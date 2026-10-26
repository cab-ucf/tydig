// The link collaborators open: <TYDIG_PAGE>#<id>;t=<token>, tydig's static
// page plus this hub's public id and access token, both from a seed that
// stays here (it is the hub's iroh key). The page reaches
// the hub over iroh (irp's wasm client, github.com/cab-ucf/irp): no domain,
// certificate or open port. irweb/http/2: each iroh stream is one HTTP/1.0
// exchange whose request carries the token (irweb-access), handed to the
// hub's HTTP server as a connection; websockets ride the bridge below.
import express from 'express'
import { Duplex } from 'node:stream'
import { createHash, createPrivateKey, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'
import { DATA } from './store.mjs'
import { derive, newSeed, relayUrl, RELAYS } from './relay.mjs'

const PAGE = process.env.TYDIG_LINK === '0' ? '' : process.env.TYDIG_PAGE || 'https://cxn.pub/'
const PIN = process.env.TYDIG_LINK_RELAY
const ALPN = [...Buffer.from('irweb/http/2')]
const seedFile = path.join(DATA, 'link-seed')
if (PAGE && !existsSync(seedFile)) writeFileSync(seedFile, newSeed(randomBytes(16)) + '\n', { mode: 0o600 })
const seed = PAGE && readFileSync(seedFile, 'utf8').trim()
const secret = PAGE && [...derive(seed, 'irweb v1 endpoint identity')]
const TOKEN = PAGE && Buffer.from(Buffer.from(derive(seed, 'irweb v2 access token')).toString('hex'))
const iroh = PAGE && await import('@number0/iroh')
const pkcs8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const id = PAGE && newSeed(createPublicKey(createPrivateKey({ key: Buffer.concat([pkcs8, Buffer.from(secret)]),
  format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(12))
export const LINK = PAGE && `${PAGE}#${id};t=${TOKEN}` + (PIN ? `;r=${PIN}` : '')
if (LINK) writeFileSync(path.join(DATA, 'link'), LINK + '\n', { mode: 0o600 })
export let online = false

export async function start(server) {
  if (!LINK) return
  // Relays in order, not the nearest: the dedicated one pings slower but moves
  // more. The page dials them all, so wherever the hub lands it is found.
  const rs = PIN ? [relayUrl(PIN)] : RELAYS
  let ep
  for (const [i, r] of rs.entries()) {
    const b = iroh.Endpoint.builder()
    b.applyMinimal(); b.secretKey(secret); b.alpns([ALPN])
    b.relayMode(iroh.RelayMode.customFromUrls([r]))
    ep = await b.bind()
    if (i === rs.length - 1 || await Promise.race([ep.online().then(() => true),
      new Promise(ok => setTimeout(ok, 10_000, false))])) break
    await ep.close()
  }
  ;(async () => {
    for (let inc; (inc = await ep.acceptNext().catch(() => null));) (async () => {
      const conn = await (await inc.accept()).connect(), peer = conn.remoteId().toString()
      for (;;) serve(server, await conn.acceptBi(), conn, peer).catch(() => {})
    })().catch(() => {})
  })()
  const late = setTimeout(() => console.warn('link: no relay yet; the hub needs outbound HTTPS to its relay'), 20_000)
  await ep.online(); clearTimeout(late); online = true
  console.log(`link: online, ${LINK}`)
}

// The request's head is read first: without the token, 403 and the
// connection closed. The browser half-closes after its request; that end is
// never passed on, or Node's server would drop the reply.
async function serve(server, { send, recv }, conn, peer) {
  let head = Buffer.alloc(0), c
  const late = setTimeout(() => recv.stop(0n).catch(() => {}), 30_000)
  while (head.indexOf('\r\n\r\n') < 0 && head.length < 64 << 10 && (c = await recv.read(64 << 10))?.length)
    head = Buffer.concat([head, Buffer.from(c)])
  clearTimeout(late)
  const t = Buffer.from(/^irweb-access:[ \t]*(\S*)[ \t]*\r$/im
    .exec(head.subarray(0, head.indexOf('\r\n\r\n') + 2))?.[1] ?? '')
  if (t.length !== TOKEN.length || !timingSafeEqual(t, TOKEN)) {
    await send.writeAll([...Buffer.from('HTTP/1.0 403 Forbidden\r\ncontent-length: 0\r\n\r\n')])
    await send.finish(); await send.stopped()
    return conn.close(0n, [...Buffer.from('forbidden')])
  }
  const d = new Duplex({
    read() { recv.read(64 << 10).then(c => c?.length && this.push(Buffer.from(c)), e => this.destroy(e)) },
    write(c, _, cb) { send.writeAll([...c]).then(() => cb(), cb) },
    final(cb) { send.finish().finally(() => { cb(); this.destroy() }) },
    destroy(e, cb) { send.finish().catch(() => {}); cb(e) },
  })
  d.push(head)
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
