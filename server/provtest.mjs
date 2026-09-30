// Post-quantum provenance tests: device key registration, signed checkpoint
// verification (signature + file-state match), tamper and wrong-user
// rejection, and history exposure. Run with the server up (UNSAFE mode ok).
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { canon, sha256hex } from './prov.mjs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const B = 'http://localhost:3000'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = true
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL'), name); pass &&= cond }

const signup = async (email, name) => {
  const r = await fetch(`${B}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ email, password: 'password123', name }),
  })
  return r.headers.getSetCookie()[0].split(';')[0]
}
const apiAs = cookie => (p, opt = {}) => fetch(B + '/api' + p,
  { ...opt, headers: { ...opt.headers, cookie, origin: B } }).then(r => r.json())

const b64u = b => Buffer.from(b).toString('base64url')
const now = Date.now()
const ann = apiAs(await signup(`prov-ann${now}@t.co`, 'Ann'))
const eve = apiAs(await signup(`prov-eve${now}@t.co`, 'Eve'))

const PROJ = `prov${now}`.slice(0, 20)
await ann(`/projects/${PROJ}`, { method: 'POST' })

// device key: generate + register under Ann
const keys = ml_dsa65.keygen(crypto.getRandomValues(new Uint8Array(32)))
const publicKey = b64u(keys.publicKey)
const proofFor = id => b64u(ml_dsa65.sign(new TextEncoder().encode(canon({ register: id })), keys.secretKey))
const squat = await eve('/keys', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publicKey, label: 'squat', proof: proofFor('someone-else') }) })
check('key cannot be registered without proof of possession', !!squat.error)
const reg = await ann('/keys', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publicKey, label: 'test-device', proof: proofFor((await ann('/me')).id) }) })
check('device key registered', typeof reg.keyId === 'string' && reg.alg === 'ml-dsa-65')
const mine = await ann('/keys')
check('key listed for owner', mine.some(k => k.keyId === reg.keyId))

// canonical file digest, computed the way the client does (from the same
// files the server sees on disk: no doc is open in this test)
// These MUST match server/index.mjs: the canonical file set a checkpoint
// signs is the CRDT-managed text files, generated dirs excluded. (The real
// client derives it from its replica, so it cannot drift; this test mirrors
// the rule by hand and would fail loudly if the two disagreed -- which is
// exactly what the stateOk check is for.)
const GENERATED = /^(out|build|figures)\//
const TEXT = /\.(typ|bib|csv|tsv|py|jl|r|toml|yaml|yml|json|md|txt|tex|just|mk)$|(^|\/)(justfile|Makefile|makefile|GNUmakefile|\.gitignore)$/i
async function* walk(dir, base = dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, base)
    else yield path.relative(base, p).replaceAll('\\', '/')
  }
}
const files = {}
for await (const rel of walk(`data/${PROJ}`))
  if (TEXT.test(rel) && !GENERATED.test(rel))
    files[rel] = sha256hex(await readFile(`data/${PROJ}/${rel}`, 'utf8'))
check('digest covers the template sources', 'main.typ' in files && 'Makefile' in files && !('build/results.json' in files))

const payload = { v: 1, alg: 'ml-dsa-65', project: PROJ, message: 'signed cp', ts: new Date().toISOString(), files }
const signature = b64u(ml_dsa65.sign(new TextEncoder().encode(canon(payload)), keys.secretKey))

// 1) valid signed checkpoint by the key's owner -> verified
const cp = await ann(`/p/${PROJ}/checkpoint`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'signed cp', payload, publicKey, signature }) })
check('signed checkpoint verified', cp.ok && cp.provenance?.verified === true)

// 2) tampered payload -> signature check fails
const bad = { ...payload, message: 'evil' }
const cp2 = await ann(`/p/${PROJ}/checkpoint`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'tampered', payload: bad, publicKey, signature }) })
check('tampered payload rejected', cp2.provenance?.verified === false && cp2.provenance?.sigOk === false)

// 3) Eve replays Ann's valid signature under her own session -> key not hers
await ann(`/p/${PROJ}/checkpoint`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'reset' }) })
const inv = await eve(`/p/${PROJ}/checkpoint`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'signed cp', payload, publicKey, signature }) })
check("replay under another account not verified (or blocked by membership)",
  inv.error != null || inv.provenance?.verified === false)

// 4) wrong file state: hash mismatch -> stateOk false
const drift = { ...payload, files: { ...files, 'main.typ': '0'.repeat(64) }, ts: new Date().toISOString() }
const sig4 = b64u(ml_dsa65.sign(new TextEncoder().encode(canon(drift)), keys.secretKey))
const cp4 = await ann(`/p/${PROJ}/checkpoint`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'drift', payload: drift, publicKey, signature: sig4 }) })
check('state mismatch not verified', cp4.provenance?.verified === false && cp4.provenance?.stateOk === false && cp4.provenance?.sigOk === true)

// 5) history exposes verification
await sleep(200)
const hist = await ann(`/p/${PROJ}/history`)
const signed = hist.find(h => h.message === 'checkpoint: signed cp' && h.provenance)
check('history shows verified provenance', signed?.provenance?.verified === true && signed?.provenance?.keyId === reg.keyId)
check('autosave commits carry no provenance', hist.some(h => !h.provenance))
const { execSync } = await import('node:child_process')
const note = JSON.parse(execSync(`git -C data/${PROJ} notes --ref=provenance show ${signed.hash}`).toString())
check('note alone verifies offline (carries the public key)', ml_dsa65.verify(Buffer.from(note.signature, 'base64url'), new TextEncoder().encode(canon(note.payload)), Buffer.from(note.publicKey, 'base64url')))

console.log(pass ? '\nALL PASS' : '\nFAILURES')
process.exit(pass ? 0 : 1)
