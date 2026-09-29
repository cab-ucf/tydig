// Post-quantum checkpoint provenance, client side.
//
// The browser generates an ML-DSA-65 device keypair on first use; the secret
// key never leaves this device (localStorage). The public key is registered
// against the signed-in account, and each checkpoint is signed over a
// canonical digest of every text file in the project, so authorship of a
// checkpoint can be audited offline from the git repo alone -- and the
// signatures stay sound against quantum adversaries.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

const b64u = bytes => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(
  atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))

// Deterministic JSON, identical to server/prov.mjs.
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  return JSON.stringify(v)
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// one key per account: two accounts in one browser must not share a key
const STORE = user => `tydig.devicekey:${user}`
export function deviceKey(user) {
  let k = null
  try { k = JSON.parse(localStorage[STORE(user)]) } catch {}
  if (!k?.publicKey || !k?.secretKey) {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const pair = ml_dsa65.keygen(seed)
    k = { alg: 'ml-dsa-65', publicKey: b64u(pair.publicKey), secretKey: b64u(pair.secretKey) }
    localStorage[STORE(user)] = JSON.stringify(k)
  }
  return k
}

let registered = false
export async function registerDeviceKey(api, user) {
  if (registered) return
  const k = deviceKey(user)
  const proof = b64u(ml_dsa65.sign(new TextEncoder().encode(canon({ register: user })), unb64u(k.secretKey)))
  const label = (navigator.userAgentData?.platform || navigator.platform || 'browser').slice(0, 40)
  const r = await api('/keys', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: k.publicKey, label, proof }),
  }).catch(() => null)
  if (r?.keyId) registered = true
  return r
}

// Sign the checkpoint: payload covers project, message, time, and the sha256
// of every CRDT text file. The server independently recomputes the file map;
// "verified" requires both the signature and the state to match.
export async function signCheckpoint({ user, project, message, files }) {
  const k = deviceKey(user)
  const hashed = {}
  for (const [path, text] of files) hashed[path] = await sha256hex(text)
  const payload = {
    v: 1, alg: k.alg, project, message,
    ts: new Date().toISOString(), files: hashed,
  }
  const sig = ml_dsa65.sign(new TextEncoder().encode(canon(payload)), unb64u(k.secretKey))
  return { payload, publicKey: k.publicKey, signature: b64u(sig) }
}
