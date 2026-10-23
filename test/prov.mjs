// Signed checkpoints: key registration needs proof of possession; a
// signature verifies only by its owner, over the hub's own file state.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { canon } from '../server/history.mjs'
import { person, check, done } from './lib.mjs'

const b64u = b => Buffer.from(b).toString('base64url')
const sign = (x, k) => b64u(ml_dsa65.sign(new TextEncoder().encode(canon(x)), k))
const ann = await person('Ann'), eve = await person('Eve'), P = `prov${Date.now()}`.slice(0, 20)
await ann.post(`/projects/${P}`)

const keys = ml_dsa65.keygen(crypto.getRandomValues(new Uint8Array(32))), publicKey = b64u(keys.publicKey)
const proof = id => sign({ register: id }, keys.secretKey)
check('a key cannot be registered without proof of possession',
  (await eve.post('/keys', { publicKey, proof: proof('someone-else') })).error)
const reg = await ann.post('/keys', { publicKey, label: 'test', proof: proof((await ann.get('/me')).id) })
check('device key registered', typeof reg.keyId === 'string' && reg.alg === 'ml-dsa-65')
check('key listed for its owner', (await ann.get('/keys')).some(k => k.keyId === reg.keyId))

// the client's digest: every text file the hub keeps in the CRDT
const files = Object.fromEntries((await ann.get(`/p/${P}/files`)).map(f => f.path)
  .filter(p => !/^(out|build|figures)\//.test(p))
  .map(p => [p, createHash('sha256').update(readFileSync(`data/${P}/${p}`, 'utf8')).digest('hex')]))
check('digest covers the sources', 'main.typ' in files && 'Makefile' in files)
const payload = { v: 1, alg: 'ml-dsa-65', project: P, message: 'signed cp', ts: new Date().toISOString(), files }
const signature = sign(payload, keys.secretKey), cp = b => ann.post(`/p/${P}/checkpoint`, b)

check('signed checkpoint verified', (await cp({ message: 'signed cp', payload, publicKey, signature })).provenance?.verified)
const t = (await cp({ message: 'tampered', payload: { ...payload, message: 'evil' }, publicKey, signature })).provenance
check('tampered payload rejected', !t.verified && !t.sigOk)
const r = await eve.post(`/p/${P}/checkpoint`, { message: 'signed cp', payload, publicKey, signature })
check('replay by another account refused', r.error || r.provenance?.verified === false)
const drift = { ...payload, files: { ...files, 'main.typ': '0'.repeat(64) } }
const d = (await cp({ message: 'drift', payload: drift, publicKey, signature: sign(drift, keys.secretKey) })).provenance
check('state mismatch not verified', !d.verified && !d.stateOk && d.sigOk)

const hist = await ann.get(`/p/${P}/history`), signed = hist.find(h => h.message === 'checkpoint: signed cp' && h.provenance)
check('history shows verified provenance', signed?.provenance.verified && signed.provenance.keyId === reg.keyId)
check('history names the signer and the author', signed.provenance.by === 'Ann' && signed.author === 'Ann')
check('history says what changed', hist.some(h => h.files.some(f => f.path === 'main.typ' && f.add > 0)))
check('autosaves carry none', hist.some(h => !h.provenance))
// live edits: whoever typed is the autosave's author, the next a co-author
const bob = await person('Bob'), sleep = ms => new Promise(r => setTimeout(r, ms))
await ann.post(`/p/${P}/members`, { email: bob.email })
const A = ann.doc(P), B = bob.doc(P)
await sleep(1500)
A.files.get('main.typ').insert(0, 'ann ')
B.files.get('main.typ').insert(0, 'bob ')
await sleep(4000)
const commits = async () => (await ann.get(`/p/${P}/history`)).filter(h => h.message.startsWith('autosave'))
check('edits are not committed while editing goes on', !(await commits()).length)
A.provider.destroy(); B.provider.destroy(); await sleep(3000) // closed: committed now
const [auto] = await commits()
check('an autosave names who edited, in its author, co-authors and message', auto?.author === 'Ann' &&
  auto.coauthors.includes('Bob') && auto.message === 'autosave by Ann, Bob')
const note = JSON.parse(execSync(`git -C data/${P} notes --ref=provenance show ${signed.hash}`))
check('the note alone verifies offline', ml_dsa65.verify(Buffer.from(note.signature, 'base64url'),
  new TextEncoder().encode(canon(note.payload)), Buffer.from(note.publicKey, 'base64url')))
done()
