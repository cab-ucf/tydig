// Browser links: <TYDIG_PAGE>#<seed>. The page is the tydig client on a static
// host plus irp's wasm iroh client (github.com/cab-ucf/irp). It derives this
// hub's key and home relay from the seed, as irp does, and sends one HTTP/1.0
// exchange per stream. Each stream is handed to the hub's own HTTP server as a
// connection, so nothing behind it knows the difference. No domain, no TLS
// certificate, no open port: the hub can sit behind NAT on a laptop.
import { blake3 } from '@noble/hashes/blake3.js'
import { Duplex } from 'node:stream'

const ALPN = [...Buffer.from('irweb/http/1')]
const RELAYS = ['https://use1-1.relay.n0.iroh.link./', 'https://usw1-1.relay.n0.iroh.link./',
  'https://euc1-1.relay.n0.iroh.link./', 'https://aps1-1.relay.n0.iroh.link./']
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const bytes = seed => { // 26 base32 chars <-> 16 bytes, as data-encoding does
  let bits = 0, n = 0; const out = []
  for (const c of seed) { n = (n << 5 | B32.indexOf(c)) & 0xfff; bits += 5; if (bits >= 8) out.push(n >> (bits -= 8) & 255) }
  return Uint8Array.from(out)
}
export const newSeed = u8 => {
  let bits = 0, n = 0, s = ''
  for (const b of u8) { n = (n << 8 | b) & 0xffff; bits += 8; while (bits >= 5) s += B32[n >> (bits -= 5) & 31] }
  return s + B32[n << (5 - bits) & 31]
}
const derive = (s, ctx) => blake3(bytes(s), { context: Buffer.from(ctx) })

export async function startLink({ server, seed, relay }) {
  const iroh = await import('@number0/iroh')
  const b = iroh.Endpoint.builder()
  b.applyMinimal()
  b.secretKey([...derive(seed, 'irweb v1 endpoint identity')])
  b.relayMode(iroh.RelayMode.customFromUrls([relay || RELAYS[derive(seed, 'irweb v1 relay')[0] % RELAYS.length]]))
  b.alpns([ALPN])
  const ep = await b.bind()
  ;(async () => {
    for (let inc; (inc = await ep.acceptNext().catch(() => null));)
      (async () => {
        const conn = await (await inc.accept()).connect()
        for (;;) serve(server, await conn.acceptBi())
      })().catch(() => {})
  })()
  return { close: () => ep.close().catch(() => {}) }
}

function serve(server, { send, recv }) {
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
  server.emit('connection', d)
}
