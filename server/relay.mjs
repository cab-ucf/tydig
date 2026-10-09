// A link's seed names its hub's key, as irp derives it; the hub (link.mjs)
// and the page (client/src/link.js) both import this. #<seed>;r=<relay>
// names the hub's relay: one of n0's by region (use1-1) or any URL. With no
// ;r=, the relay is derived from the seed, as irp does.
import { blake3 } from '@noble/hashes/blake3.js'

const RELAYS = ['use1-1', 'usw1-1', 'euc1-1', 'aps1-1']
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
export const relayFor = seed => relayUrl(RELAYS[derive(seed, 'irweb v1 relay')[0] % RELAYS.length])
// The region answering fastest from here, or null if none answers.
export async function nearest() {
  const t = await Promise.all(RELAYS.map(async r => {
    const t0 = performance.now()
    return fetch(relayUrl(r) + 'ping', { signal: AbortSignal.timeout(5000) }).then(() => performance.now() - t0, () => Infinity)
  }))
  return t.some(isFinite) ? RELAYS[t.indexOf(Math.min(...t))] : null
}
