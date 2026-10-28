// The link collaborators open: <TYDIG_PAGE>#<id>;t=<token>, tydig's static
// page plus this hub's public id and access token, both from a seed that
// stays here. The page reaches the hub over iroh (irp's wasm client,
// github.com/cab-ucf/irp): no domain, certificate or open port. tydig-link
// (link/, Rust) holds the key and hands each iroh stream, one HTTP/1.0
// exchange (irweb/http/2), to the hub's HTTP server through a socket of the
// hub's own; websockets ride the bridge below. Every request on those sockets
// carries the token (ok below).
import express from 'express'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { WebSocket } from 'ws'
import { DATA } from './store.mjs'
import { derive, newSeed, relayUrl, RELAYS } from './relay.mjs'

const PAGE = process.env.TYDIG_LINK === '0' ? '' : process.env.TYDIG_PAGE || 'https://cxn.pub/'
const PIN = process.env.TYDIG_LINK_RELAY
const seedFile = path.join(DATA, 'link-seed')
if (PAGE && !existsSync(seedFile)) writeFileSync(seedFile, newSeed(randomBytes(16)) + '\n', { mode: 0o600 })
const seed = PAGE && readFileSync(seedFile, 'utf8').trim()
const secret = PAGE && derive(seed, 'irweb v1 endpoint identity')
const TOKEN = PAGE && Buffer.from(Buffer.from(derive(seed, 'irweb v2 access token')).toString('hex'))
// its public half, as iroh makes it: Ed25519 from the 32 bytes as a seed
const id = secret && createPublicKey(createPrivateKey({ format: 'der', type: 'pkcs8',
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), secret]) }))
  .export({ type: 'spki', format: 'der' }).subarray(-32)
export const LINK = PAGE && `${PAGE}#${newSeed(id)};t=${TOKEN}` + (PIN ? `;r=${PIN}` : '')
if (LINK) writeFileSync(path.join(DATA, 'link'), LINK + '\n', { mode: 0o600 })
export let online = false
// a request over the link carries its token, compared in constant time;
// refused, its socket is closed unanswered (index.mjs), so tydig-link answers
// 403 and closes the page's connection
export const ok = req => {
  if (!req.socket.link) return true
  const t = Buffer.from(String(req.headers['irweb-access'] ?? ''))
  return t.length === TOKEN.length && timingSafeEqual(t, TOKEN)
}

export async function start(server) {
  if (!LINK) return
  // each stream: the peer's id, a nod back once it is read, then its exchange
  const sock = path.join(DATA, 'link.sock')
  rmSync(sock, { force: true })
  await new Promise((ok, no) => net.createServer(s => s.on('error', () => {}).once('readable', function peer() {
    const b = s.read(32)
    if (!b) return s.once('readable', peer)
    s.link = true // only our page speaks on these: they count as the hub's origin
    // its own sign-in rate limit: a private IPv6 address per iroh id
    s.ip = (h => `fd${h.slice(0, 2)}:${h.slice(2, 14).match(/.{4}/g).join(':')}::1`)(
      createHash('sha256').update(b.toString('hex')).digest('hex'))
    s.write('\0'); server.emit('connection', s)
  })).on('error', no).listen(sock, ok))
  const p = spawn('tydig-link', [sock, ...PIN ? [relayUrl(PIN)] : RELAYS], { stdio: ['pipe', 'pipe', 'inherit'] })
  p.stdin.on('error', () => {}).write(secret) // and held open: it leaves with the hub
  const late = setTimeout(() => console.warn('link: no relay yet; the hub needs outbound HTTPS to its relay'), 20_000)
  createInterface({ input: p.stdout }).on('line', l => {
    if (l === 'online') { clearTimeout(late); online = true; console.log(`link: online, ${LINK}`) }
  })
  p.on('error', e => console.warn(`link: ${e.message} (the image has tydig-link; elsewhere, cargo install --path link)`))
    .on('exit', c => { clearTimeout(late); online = false; c == null || console.warn(`link: tydig-link stopped (${c})`) })
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
