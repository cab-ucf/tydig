// A link's seed names its hub's key, as irp derives it; the hub (link.mjs)
// and the page (client/src/link.js) both import this. The relay is n0's
// US-East one (use1-1) unless the link names another (#<seed>;r=<region or
// URL>, from TYDIG_LINK_RELAY): networks that block other countries still
// reach it, where a relay picked by hash or distance could be Singapore.
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
export const RELAY = 'use1-1'
