// Federation test: two independent hubs (separate ports, data dirs, iroh
// identities) sync one project over iroh. Edits made through a browser-style
// sync connection on hub A must appear on hub B's disk, and vice versa; a
// wrong token must be refused. Started by `just test` (see the Justfile), or:
//   PORT=3100 TYDIG_DATA=/tmp/hubA TYDIG_IROH_RELAY=local ... node server/index.mjs &
//   PORT=3200 TYDIG_DATA=/tmp/hubB TYDIG_IROH_RELAY=local ... node server/index.mjs &
//   node server/fedtest.mjs
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
import { readFile } from 'node:fs/promises'

const A = process.env.HUB_A || 'http://localhost:3100'
const B = process.env.HUB_B || 'http://localhost:3200'
const DATA_A = process.env.DATA_A || '/tmp/tydig-hubA'
const DATA_B = process.env.DATA_B || '/tmp/tydig-hubB'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const until = async (fn, ms = 30000, step = 500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(step) } return false }

async function hub(base, who) {
  const r = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: `${who}${Date.now()}@example.com`, password: 'password123', name: who }) })
  const cookie = r.headers.getSetCookie()[0].split(';')[0]
  const token = /session_token=([^;]+)/.exec(cookie)[1]
  const api = (p, o = {}) => fetch(base + '/api' + p, { ...o, headers: { ...o.headers, cookie, origin: base } }).then(r => r.json())
  return { base, api, token }
}

const a = await hub(A, 'ann'), b = await hub(B, 'bob')
const fa = await a.api('/federation'), fb = await b.api('/federation')
check('both hubs run iroh endpoints with distinct ids', fa.enabled && fb.enabled && fa.id && fb.id && fa.id !== fb.id)

// A creates the project from the template and mints an invite
const PROJ = 'fedpaper'
await a.api(`/projects/${PROJ}`, { method: 'POST' })
const { invite } = await a.api(`/p/${PROJ}/federation/invite`, { method: 'POST' })
check('invite minted', /^tydig-fed:fedpaper:[\w-]+:endpoint/.test(invite || ''))

// B joins by invite: empty project, populated by sync
const joined = await b.api(`/projects/${PROJ}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite }) })
check('B joined via invite', joined.ok === true && joined.federated === true)

// The joined project fills in from A over iroh and lands on B's disk
const filled = await until(async () => {
  const files = await b.api(`/p/${PROJ}/files`)
  return files.some(f => f.path === 'main.typ') && files.some(f => f.path === 'scripts/analysis.py')
}, 40000)
check('template files arrived on hub B over iroh and were mirrored to disk', filled)

const stA = await a.api(`/p/${PROJ}/federation`), stB = await b.api(`/p/${PROJ}/federation`)
check('both hubs report the connection', stA.project.connected.length >= 1 && stB.project.connected.length >= 1)
check('A sees B inbound, B sees A outbound',
  stA.project.connected.some(c => c.direction === 'inbound') && stB.project.connected.some(c => c.direction === 'outbound'))

// A edits through a normal sync connection (what a browser does)
const docA = new Y.Doc()
new HocuspocusProvider({ url: `ws://localhost:${new URL(A).port}/sync`, name: PROJ, document: docA, token: a.token, WebSocketPolyfill: WebSocket })
await until(async () => docA.getMap('files').has('main.typ'), 15000)
const MARK_A = `// federated edit from A ${Date.now()}`
docA.getMap('files').get('main.typ').insert(0, MARK_A + '\n')
const onB = await until(async () => (await readFile(`${DATA_B}/${PROJ}/main.typ`, 'utf8')).includes(MARK_A), 30000)
check('edit on A appears on B\'s disk (mirror -> git -> builds all downstream)', onB)

// B edits, A receives
const docB = new Y.Doc()
new HocuspocusProvider({ url: `ws://localhost:${new URL(B).port}/sync`, name: PROJ, document: docB, token: b.token, WebSocketPolyfill: WebSocket })
await until(async () => docB.getMap('files').has('main.typ'), 15000)
const MARK_B = `// federated edit from B ${Date.now()}`
docB.getMap('files').set('notes.typ', new Y.Text(MARK_B))
const onA = await until(async () => (await readFile(`${DATA_A}/${PROJ}/notes.typ`, 'utf8')).includes(MARK_B), 30000)
check('new file on B appears on A\'s disk', onA)
check('A\'s edit still present on A after B\'s edit (no clobber)', (await readFile(`${DATA_A}/${PROJ}/main.typ`, 'utf8')).includes(MARK_A))

// Both replicas converge to the same file set
await sleep(3000)
const setA = new Set([...docA.getMap('files').keys()]), setB = new Set([...docB.getMap('files').keys()])
check('both replicas hold the same files', setA.size === setB.size && [...setA].every(k => setB.has(k)))

// Wrong token is refused
const bad = invite.replace(/^(tydig-fed:fedpaper:)[\w-]+/, '$1wrongtoken')
const c = await hub(B, 'eve')
const badJoin = await c.api(`/projects/other`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: bad }) })
check('invite for a different project name is rejected', !!badJoin.error)

console.log(pass ? '\nFEDERATION ALL PASS' : '\nFEDERATION FAILURES')
process.exit(pass ? 0 : 1)
