// Signed checkpoints. Each browser makes an ML-DSA-65 (post-quantum) key on
// first use; the secret half stays in this browser, the public half is
// registered to the account. A checkpoint is signed over the sha256 of every
// text file, so who made it can be checked offline from the git repo alone.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

const b64u = bytes => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const utf8 = s => new TextEncoder().encode(s)

// Deterministic JSON, identical to server/history.mjs.
const canon = v => Array.isArray(v) ? `[${v.map(canon)}]` : !v || typeof v !== 'object' ? JSON.stringify(v)
  : `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k]))}}`
const sha256hex = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)))]
  .map(b => b.toString(16).padStart(2, '0')).join('')

// one key per account: two accounts in one browser must not share one
function deviceKey(user) {
  const at = `tydig.devicekey:${user}`
  let k = null
  try { k = JSON.parse(localStorage[at]) } catch {}
  if (!k?.publicKey || !k?.secretKey) {
    const pair = ml_dsa65.keygen(crypto.getRandomValues(new Uint8Array(32)))
    k = { alg: 'ml-dsa-65', publicKey: b64u(pair.publicKey), secretKey: b64u(pair.secretKey) }
    localStorage[at] = JSON.stringify(k)
  }
  return k
}
const sign = (k, v) => b64u(ml_dsa65.sign(utf8(canon(v)), unb64u(k.secretKey)))

let registered = false
export async function registerDeviceKey(api, user) {
  if (registered) return
  const k = deviceKey(user)
  const label = (navigator.userAgentData?.platform || navigator.platform || 'browser').slice(0, 40)
  const body = JSON.stringify({ publicKey: k.publicKey, label, proof: sign(k, { register: user }) })
  const r = await api('/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    .catch(() => null)
  registered = !!r?.keyId
}

// The payload covers project, message, time and every file's hash; the hub
// recomputes the hashes itself, and "verified" needs both to match.
export async function signCheckpoint({ user, project, message, files }) {
  const k = deviceKey(user), hashed = {}
  for (const [path, text] of files) hashed[path] = await sha256hex(text)
  const payload = { v: 1, alg: k.alg, project, message, ts: new Date().toISOString(), files: hashed }
  return { payload, publicKey: k.publicKey, signature: sign(k, payload) }
}
