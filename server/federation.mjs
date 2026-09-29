// Hub-to-hub federation over iroh.
//
// Each hub runs one iroh endpoint: a QUIC endpoint whose address *is* its
// public key. Hubs dial each other by that key -- through NAT via hole
// punching, falling back to n0's public relays, which only ever see
// ciphertext. No domain, no certificate, no open port, no account with
// anyone: a hub on a laptop at home can federate with a lab's hub as an
// equal. Every connection is end-to-end encrypted and mutually authenticated
// by construction (the endpoint key is the TLS identity).
//
// What travels: the project's Yjs document -- files and comments -- using the
// standard state-vector/update exchange, so any number of hubs converge. Each
// hub then mirrors to its own disk, commits to its own git, and runs its own
// builds, so a project has no home hub. Lose one and nothing is lost.
//
// Membership is a capability: an invite string carries the project name, a
// per-project random token, and this hub's iroh ticket. Presenting the token
// on connect is what authorises a peer hub to sync that project. Rotate the
// token to evict everyone.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import * as Y from 'yjs'

const ALPN = Array.from(new TextEncoder().encode('tydig/federate/1'))
const MSG = { HELLO: 0, WELCOME: 1, SV: 2, UPDATE: 3, REJECT: 4 }
const MAX_FRAME = 64 * 1024 * 1024
const enc = new TextEncoder(), dec = new TextDecoder()

// ---- framing: u8 type, u32 length, payload ----
const frame = (type, payload) => {
  const out = new Uint8Array(5 + payload.length)
  out[0] = type
  new DataView(out.buffer).setUint32(1, payload.length)
  out.set(payload, 5)
  return Array.from(out)
}
async function readFrame(recv) {
  const head = new Uint8Array(await recv.readExact(5))
  const type = head[0]
  const len = new DataView(head.buffer).getUint32(1)
  if (len > MAX_FRAME) throw new Error('frame too large')
  const payload = len ? new Uint8Array(await recv.readExact(len)) : new Uint8Array()
  return { type, payload }
}

export function createFederation({ hocuspocus, dataDir, okName, log = console.log }) {
  const fedDir = path.join(dataDir, 'federation')
  const cfgPath = proj => path.join(fedDir, `${proj}.json`)
  let iroh = null, endpoint = null, ticket = null, closed = false
  const peers = new Map()        // `${proj}|${remoteId}` -> { proj, remoteId, since, direction }
  const dialers = new Map()      // `${proj}|${ticket}` -> { stop }
  const docs = new Map()         // proj -> DirectConnection (keeps the doc loaded)
  const enabled = process.env.TYDIG_IROH !== '0'

  async function cfg(proj) {
    try { return JSON.parse(await readFile(cfgPath(proj), 'utf8')) } catch { return null }
  }
  async function saveCfg(proj, c) {
    await mkdir(fedDir, { recursive: true })
    await writeFile(cfgPath(proj), JSON.stringify(c, null, 1))
  }
  async function ensureCfg(proj) {
    let c = await cfg(proj)
    if (!c) { c = { token: randomBytes(24).toString('base64url'), peers: [] }; await saveCfg(proj, c) }
    return c
  }

  async function doc(proj) {
    if (!docs.has(proj)) docs.set(proj, await hocuspocus.openDirectConnection(proj, { federation: true }))
    return docs.get(proj).document
  }

  // ---- the sync session, symmetric once the handshake is done ----
  async function session(conn, bi, proj, direction) {
    const ydoc = await doc(proj)
    const remoteId = conn.remoteId().toString()
    const key = `${proj}|${remoteId}`
    peers.set(key, { proj, remoteId, since: Date.now(), direction, conn })
    log(`federation: ${direction} peer ${remoteId.slice(0, 10)}… synced on "${proj}"`)
    const origin = { federation: remoteId }
    let alive = true
    // one frame at a time: concurrent writes on a stream could interleave bytes
    let q = Promise.resolve()
    const send = (type, payload) => (q = q.then(() => bi.send.writeAll(frame(type, payload))).catch(() => { alive = false }))
    const onUpdate = (update, o) => { if (o !== origin && alive) send(MSG.UPDATE, update) }
    ydoc.on('update', onUpdate)
    try {
      await send(MSG.SV, Y.encodeStateVector(ydoc))
      while (alive) {
        const { type, payload } = await readFrame(bi.recv)
        if (type === MSG.SV) await send(MSG.UPDATE, Y.encodeStateAsUpdate(ydoc, payload))
        else if (type === MSG.UPDATE) Y.applyUpdate(ydoc, payload, origin)
      }
    } catch (e) {
      if (!closed) log(`federation: peer ${remoteId.slice(0, 10)}… on "${proj}" dropped (${e.message})`)
    } finally {
      alive = false
      ydoc.off('update', onUpdate)
      peers.delete(key)
    }
  }

  // ---- inbound: verify the token, then sync ----
  async function acceptLoop() {
    while (!closed) {
      let incoming
      try { incoming = await endpoint.acceptNext() } catch { if (closed) return; continue }
      if (!incoming) return
      ;(async () => {
        try {
          const conn = await (await incoming.accept()).connect()
          const bi = await conn.acceptBi()
          const hello = await readFrame(bi.recv)
          if (hello.type !== MSG.HELLO) return conn.close(1n, Array.from(enc.encode('expected hello')))
          const { proj, token } = JSON.parse(dec.decode(hello.payload))
          const c = okName(proj) ? await cfg(proj) : null
          if (!c || c.token !== token || !existsSync(path.join(dataDir, proj))) {
            await bi.send.writeAll(frame(MSG.REJECT, enc.encode('unknown project or bad token')))
            log(`federation: refused ${conn.remoteId().toString().slice(0, 10)}… for "${proj}"`)
            return conn.close(2n, Array.from(enc.encode('refused')))
          }
          await bi.send.writeAll(frame(MSG.WELCOME, new Uint8Array()))
          await session(conn, bi, proj, 'inbound')
        } catch (e) { if (!closed) log(`federation: inbound failed (${e.message})`) }
      })()
    }
  }

  // ---- outbound: keep one connection per linked peer alive ----
  function dial(proj, peer) {
    const key = `${proj}|${peer.ticket}`
    if (dialers.has(key)) return
    let stopped = false, delay = 3000
    ;(async () => {
      while (!stopped && !closed) {
        try {
          const addr = iroh.EndpointTicket.fromString(peer.ticket).endpointAddr()
          const conn = await endpoint.connect(addr, ALPN)
          const bi = await conn.openBi()
          const c = await cfg(proj)
          await bi.send.writeAll(frame(MSG.HELLO, enc.encode(JSON.stringify({ v: 1, proj, token: peer.token ?? c.token }))))
          const reply = await readFrame(bi.recv)
          if (reply.type !== MSG.WELCOME) throw new Error(`refused: ${dec.decode(reply.payload)}`)
          delay = 3000
          await session(conn, bi, proj, 'outbound')
        } catch (e) {
          if (!closed) log(`federation: dial to ${peer.ticket.slice(0, 14)}… for "${proj}" failed (${e.message}); retry in ${delay / 1000}s`)
        }
        await new Promise(r => setTimeout(r, delay))
        delay = Math.min(delay * 2, 60_000)
      }
    })()
    dialers.set(key, { stop: () => { stopped = true } })
  }

  async function dialAll() {
    if (!existsSync(fedDir)) return
    for (const f of await readdir(fedDir)) {
      if (!f.endsWith('.json') || f === 'hub.json') continue
      const proj = f.slice(0, -5)
      const c = await cfg(proj)
      for (const p of c?.peers || []) dial(proj, p)
    }
  }

  // ---- public surface ----
  return {
    enabled,
    async start() {
      if (!enabled) { log('federation: disabled (TYDIG_IROH=0)'); return }
      try { iroh = await import('@number0/iroh') }
      catch (e) { log(`federation: @number0/iroh unavailable on this platform (${e.message}); running as a standalone hub`); return }
      await mkdir(fedDir, { recursive: true })
      const keyPath = path.join(dataDir, 'iroh.secret')
      let secret
      if (existsSync(keyPath)) secret = Array.from(Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'hex'))
      else { secret = Array.from(randomBytes(32)); await writeFile(keyPath, Buffer.from(secret).toString('hex') + '\n', { mode: 0o600 }) }
      const b = iroh.Endpoint.builder()
      const mode = process.env.TYDIG_IROH_RELAY || 'n0'
      if (mode === 'off') b.applyN0DisableRelay()
      else if (mode === 'local') b.applyMinimal()   // LAN / tests: no external services at all
      else b.applyN0()                              // n0's public relays + discovery, free
      b.secretKey(secret)
      b.alpns([ALPN])
      if (process.env.TYDIG_IROH_BIND) b.bindAddr(process.env.TYDIG_IROH_BIND)
      endpoint = await b.bind()
      const refreshTicket = () => {
        try { ticket = iroh.EndpointTicket.fromAddr(endpoint.addr()).toString() } catch {}
        writeFile(path.join(fedDir, 'hub.json'), JSON.stringify({ id: endpoint.id().toString(), ticket, relay: mode, updatedAt: new Date().toISOString() }, null, 1)).catch(() => {})
      }
      refreshTicket()
      // NB: endpoint.watchAddr() panics in @number0/iroh 1.1.0 ("no reactor
      // running") and aborts the process. Poll instead.
      log(`federation: iroh endpoint ${endpoint.id().toString()} (relay: ${mode})`)
      acceptLoop()
      dialAll()
      setInterval(() => { refreshTicket(); dialAll() }, 30_000).unref()
    },
    async status(proj) {
      const c = proj ? await cfg(proj) : null
      return {
        enabled: enabled && !!endpoint,
        id: endpoint?.id().toString() || null,
        ticket,
        relay: process.env.TYDIG_IROH_RELAY || 'n0',
        project: proj ? {
          invite: c && ticket ? `tydig-fed:${proj}:${c.token}:${ticket}` : null,
          linked: (c?.peers || []).map(p => ({ ticket: p.ticket.slice(0, 20) + '…', addedAt: p.addedAt })),
          connected: [...peers.values()].filter(p => p.proj === proj)
            .map(p => ({ remoteId: p.remoteId, since: p.since, direction: p.direction })),
        } : null,
      }
    },
    // Create (or return) this project's invite string.
    async invite(proj) {
      if (!endpoint) throw new Error('federation is not running on this hub')
      const c = await ensureCfg(proj)
      return `tydig-fed:${proj}:${c.token}:${ticket}`
    },
    // Accept another hub's invite for a project of the same name here.
    async link(proj, inviteStr) {
      const m = /^tydig-fed:([\w-]+):([\w-]+):(\S+)$/.exec(String(inviteStr).trim())
      if (!m) throw new Error('not a tydig federation invite')
      const [, remoteProj, token, peerTicket] = m
      if (remoteProj !== proj) throw new Error(`invite is for project "${remoteProj}", not "${proj}"`)
      if (!endpoint) throw new Error('federation is not running on this hub')
      iroh.EndpointTicket.fromString(peerTicket)   // validate
      const c = await ensureCfg(proj)
      // Sharing a token across the federation means any member hub can invite
      // further hubs with an identical invite; the token becomes the project's.
      c.token = token
      if (!c.peers.some(p => p.ticket === peerTicket)) c.peers.push({ ticket: peerTicket, addedAt: new Date().toISOString() })
      await saveCfg(proj, c)
      dial(proj, { ticket: peerTicket })
      return { ok: true }
    },
    async rotate(proj) {
      const c = await ensureCfg(proj)
      c.token = randomBytes(24).toString('base64url')
      c.peers = []
      await saveCfg(proj, c)
      // evict means now: drop live sessions and our own dialers too
      for (const [k, d] of dialers) if (k.startsWith(proj + '|')) { d.stop(); dialers.delete(k) }
      for (const p of peers.values()) if (p.proj === proj) p.conn.close(3n, Array.from(enc.encode('token rotated')))
      return { ok: true }
    },
    async stop() {
      closed = true
      for (const d of dialers.values()) d.stop()
      for (const dc of docs.values()) await dc.disconnect().catch(() => {})
      await endpoint?.close().catch(() => {})
    },
  }
}
