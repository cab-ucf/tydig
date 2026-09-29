// Provenance: post-quantum signed checkpoints.
//
// Each browser generates an ML-DSA-65 (FIPS 204) device keypair, registers
// the public key against the signed-in account, and signs every checkpoint
// over a canonical digest of the project's files. The server verifies the
// signature AND that the signed file hashes match its own copy of the
// document, then records the result in git notes (refs/notes/provenance) so
// the whole history is auditable offline with nothing but the repo and the
// key registry. ML-DSA is a NIST post-quantum standard: these attestations
// stay valid against quantum adversaries, unlike classical ed25519.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { createHash } from 'node:crypto'

export const ALG = 'ml-dsa-65'
const b64u = buf => Buffer.from(buf).toString('base64url')
const unb64u = s => new Uint8Array(Buffer.from(s, 'base64url'))

export const sha256hex = data => createHash('sha256').update(data).digest('hex')
export const keyIdOf = publicKeyB64u => sha256hex(unb64u(publicKeyB64u)).slice(0, 16)

// Deterministic JSON: object keys sorted recursively. Client mirrors this.
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  return JSON.stringify(v)
}

export function verify(publicKeyB64u, payload, signatureB64u) {
  try {
    const msg = new TextEncoder().encode(canon(payload))
    return ml_dsa65.verify(unb64u(signatureB64u), msg, unb64u(publicKeyB64u))
  } catch { return false }
}

// ---- device key registry (per user, many devices) ----
export function initKeyStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS deviceKey (
    keyId TEXT PRIMARY KEY, userId TEXT NOT NULL, alg TEXT NOT NULL,
    publicKey TEXT NOT NULL, label TEXT, createdAt TEXT NOT NULL)`)
  const ins = db.prepare(`INSERT OR IGNORE INTO deviceKey
    (keyId, userId, alg, publicKey, label, createdAt) VALUES (?,?,?,?,?,?)`)
  const byId = db.prepare('SELECT * FROM deviceKey WHERE keyId = ?')
  const byUser = db.prepare('SELECT keyId, alg, label, createdAt FROM deviceKey WHERE userId = ?')
  return {
    // Public keys are public (every note carries one), so registering needs
    // proof of possession: a signature over {register: <this account's id>}.
    register(userId, publicKey, label = '', proof = '') {
      if (typeof publicKey !== 'string' || publicKey.length > 4000) throw new Error('bad key')
      if (!verify(publicKey, { register: userId }, proof)) throw new Error('key registration needs a valid proof of possession')
      const keyId = keyIdOf(publicKey)
      ins.run(keyId, userId, ALG, publicKey, String(label).slice(0, 80), new Date().toISOString())
      return { keyId, alg: ALG }
    },
    lookup: keyId => byId.get(keyId),
    listFor: userId => byUser.all(userId),
  }
}

// Self-test hook (used by provtest.mjs): sign with a throwaway key.
export const _testSign = (payload) => {
  const seed = new Uint8Array(32).fill(7)
  const keys = ml_dsa65.keygen(seed)
  const msg = new TextEncoder().encode(canon(payload))
  return {
    publicKey: b64u(keys.publicKey),
    signature: b64u(ml_dsa65.sign(msg, keys.secretKey)),
  }
}
