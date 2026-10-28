// Checkpoints, history and restore. A checkpoint may carry an ML-DSA-65
// (FIPS 204) signature by a key held on the author's device over the hash
// of every text file; the hub verifies it against its own copy and keeps it
// in git notes (refs/notes/provenance), checkable offline from a clone.
import express from 'express'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { createHash, randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { git, commit, live, mirror, editable, textOf, walk, proj, inProj, putText,
  hocuspocus, readIn, edited } from './store.mjs'
import { db } from './auth.mjs'
import * as remote from './remote.mjs'

const ALG = 'ml-dsa-65'
const sha256 = d => createHash('sha256').update(d).digest('hex')
const bytes = s => new Uint8Array(Buffer.from(s, 'base64url'))
const keyIdOf = pk => sha256(bytes(pk)).slice(0, 16)
// deterministic JSON: keys sorted, as the client does
export const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}`
    : JSON.stringify(v)
export const verify = (pk, payload, sig) => {
  try { return ml_dsa65.verify(bytes(sig), new TextEncoder().encode(canon(payload)), bytes(pk)) }
  catch { return false }
}

db.exec(`CREATE TABLE IF NOT EXISTS deviceKey (keyId TEXT PRIMARY KEY, userId TEXT NOT NULL,
  alg TEXT NOT NULL, publicKey TEXT NOT NULL, label TEXT, createdAt TEXT NOT NULL)`)
const keyById = db.prepare('SELECT * FROM deviceKey WHERE keyId = ?')

// /api/keys: a device registers its public key, proving it holds the secret
export const keys = express.Router()
keys.post('/', (req, res) => {
  const { publicKey: pk, label = '', proof } = req.body || {}
  if (typeof pk !== 'string' || pk.length > 4000 || !verify(pk, { register: req.user.id }, proof))
    return res.status(400).json({ error: 'a public key and a valid proof of possession' })
  db.prepare('INSERT OR IGNORE INTO deviceKey VALUES (?,?,?,?,?,?)')
    .run(keyIdOf(pk), req.user.id, ALG, pk, String(label).slice(0, 80), new Date().toISOString())
  res.json({ keyId: keyIdOf(pk), alg: ALG })
})
keys.get('/', (req, res) => res.json(db.prepare('SELECT keyId, alg, label, createdAt FROM deviceKey ' +
  'WHERE userId = ?').all(req.user.id)))

// path -> sha256 of every text file, as the client computes it
async function digest(n) {
  const doc = hocuspocus.documents.get(n), out = {}
  if (doc) for (const [p, t] of doc.getMap('files')) { if (editable(p)) out[p] = sha256(t.toString()) }
  else for await (const p of walk(proj(n))) {
    const b = editable(p) && await readIn(n, p).catch(() => null), t = b ? textOf(b) : null
    if (t != null) out[p] = sha256(t)
  }
  return out
}
// from a file: a long thread passes what one argument may hold (128 kB)
async function note(n, ref, msg) {
  const f = inProj(n, `.git/tydig-note-${randomUUID()}`)
  await writeFile(f, msg)
  await git(n, 'notes', `--ref=${ref}`, 'add', '-f', '-F', f, 'HEAD').catch(() => {})
  await rm(f, { force: true })
}

export const router = express.Router({ mergeParams: true })
router.post('/checkpoint', async (req, res) => {
  const n = req.params.proj, doc = hocuspocus.documents.get(n)
  if (doc) await mirror(n, doc)
  edited(n, req.user, true)
  const failed = await commit(n, `checkpoint: ${String(req.body?.message || 'unnamed').slice(0, 200)}`, '--allow-empty')
  if (failed) return res.status(500).json({ error: `git could not commit: ${failed}` })
  let prov = null
  const { payload, publicKey: pk, signature } = req.body || {}
  if (payload && pk && signature) {
    const known = keyById.get(keyIdOf(pk)), sigOk = verify(pk, payload, signature)
    const stateOk = canon(payload.files || {}) === canon(await digest(n))
    prov = { alg: ALG, keyId: keyIdOf(pk), publicKey: pk, user: req.user.id, sigOk, stateOk,
      registered: !!known, verified: known?.userId === req.user.id && sigOk && stateOk, payload, signature }
    await note(n, 'provenance', JSON.stringify(prov))
  }
  const comments = doc && JSON.stringify(Object.fromEntries(doc.getMap('comments')))
  if (comments && comments !== '{}') await note(n, 'comments', comments)
  // with a git remote, saving pushes; a slow one carries on after 20 s
  const pushed = (await remote.status(n)).configured ? await Promise.race([
    remote.sync(n, 'save').catch(e => ({ ok: false, error: e.message })),
    new Promise(r => setTimeout(r, 20_000, { ok: null }))]) : null
  res.json({ ok: true, pushed: pushed && { ok: pushed.ok, error: pushed.error || null },
    provenance: prov && { keyId: prov.keyId, verified: prov.verified, sigOk: prov.sigOk, stateOk: prov.stateOk } })
})
const nameOf = db.prepare('SELECT name FROM user WHERE id = ?')
// who made each commit, what it changed, and who signed it
router.get('/history', async (req, res) => {
  const log = await git(req.params.proj, 'log', '-n', '1000', '--notes=provenance', '--numstat',
    '--pretty=format:%x1e%h%x1f%aI%x1f%an%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)' +
    '%x1f%s%x1f%N%x1f').catch(() => '')
  res.json(log.split('\x1e').filter(Boolean).map(l => {
    const [hash, date, author, co, message, raw, stat] = l.split('\x1f')
    let provenance = null
    try {
      const p = JSON.parse(raw)
      provenance = { alg: p.alg, keyId: p.keyId, verified: p.verified, by: nameOf.get(p.user)?.name ?? null }
    } catch {}
    const files = stat.trim().split('\n').filter(Boolean).map(s => s.split('\t'))
      .map(([a, d, path]) => ({ path, add: +a || 0, del: +d || 0 }))
    return { hash, date, author, coauthors: co ? co.split('\x1d').map(c => c.replace(/ <.*/, '')) : [],
      message, provenance, files }
  }))
})
// every text file as it was at a commit, live for everyone
router.post('/restore/:hash', async (req, res) => {
  const { proj: n, hash } = req.params
  if (!/^[0-9a-f]{7,40}$/.test(hash)) return res.status(400).json({ error: 'bad hash' })
  if (!hocuspocus.documents.has(n)) return res.status(409).json({ error: 'project not open in any editor' })
  const EMPTY = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // git's empty tree
  const stat = await git(n, 'diff', '--numstat', '--no-renames', EMPTY, hash).catch(() => null)
  if (stat == null) return res.status(404).json({ error: 'no such commit' })
  const texts = new Map()
  for (const [added, , p] of stat.split('\n').filter(Boolean).map(l => l.split('\t')))
    if (added !== '-' && editable(p)) texts.set(p, await git(n, 'show', `${hash}:${p}`))
  await live(n, doc => doc.transact(() => {
    const files = doc.getMap('files')
    for (const k of [...files.keys()]) if (!texts.has(k)) files.delete(k)
    for (const [p, t] of texts) putText(files, p, t)
  }))
  res.json({ ok: true })
})
