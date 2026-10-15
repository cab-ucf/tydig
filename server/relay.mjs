// A link's seed names its hub's key, as irp derives it; the hub (link.mjs)
// and the page (client/src/link.js) both import this. Relays are US East
// only: the hub homes on the nearer, the page dials both. A link may pin one
// (#<id>;r=<n0 region or URL>, from TYDIG_LINK_RELAY). Never one picked by
// hash or distance, which could be Singapore and networks block it.
import { blake3 } from '@noble/hashes/blake3.js'

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
export const derive = (s, ctx) => blake3(bytes(s), { context: new TextEncoder().encode(ctx) })
export const relayUrl = r => r.includes('://') ? r : `https://${r}.relay.n0.iroh.link/`
export const RELAYS = ['https://iroh.cxn.center/', relayUrl('use1-1')]
