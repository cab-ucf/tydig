// Git-remote sync: a bare repo stands in for GitHub/GitLab/Codeberg. Two
// hubs that never talk to each other directly must still converge through
// the remote, and concurrent edits must not conflict.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

const A = process.env.HUB_A || 'http://localhost:3100'
const B = process.env.HUB_B || 'http://localhost:3200'
const DATA_A = process.env.DATA_A || '/tmp/tydig-hubA'
const DATA_B = process.env.DATA_B || '/tmp/tydig-hubB'
const REMOTE = process.env.REMOTE || '/tmp/tydig-remote.git'
const PROJ = 'gitpaper'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(500) } return false }

async function hub(base, who) {
  const r = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: `${who}${Date.now()}@example.com`, password: 'password123', name: who }) })
  const cookie = r.headers.getSetCookie()[0].split(';')[0]
  const token = /session_token=([^;]+)/.exec(cookie)[1]
  const api = (p, o = {}) => fetch(base + '/api' + p, { ...o, headers: { ...o.headers, cookie, origin: base } }).then(r => r.json())
  const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  return { base, api, post, token, port: new URL(base).port }
}
const openDoc = async (h, proj) => {
  const doc = new Y.Doc()
  new HocuspocusProvider({ url: `ws://localhost:${h.port}/sync`, name: proj, document: doc, token: h.token, WebSocketPolyfill: WebSocket })
  await until(async () => doc.getMap('files').has('main.typ'), 20000)
  return doc
}

const a = await hub(A, 'ann'), b = await hub(B, 'bob')

// A creates the project and points it at "the git server"
await a.post(`/projects/${PROJ}`)
const set = await a.post(`/p/${PROJ}/gitremote`, { url: REMOTE, branch: 'main' })
check('remote configured', set.configured === true && set.branch === 'main')
check('token-bearing URLs are redacted in status', !/:\/\/[^/@]*@/.test(set.url || ''))

const first = await a.post(`/p/${PROJ}/gitremote/sync`)
check('first push to the git server succeeded', first.ok === true)
const remoteFiles = (await run('git', ['-C', REMOTE, 'ls-tree', '-r', '--name-only', 'main'])).stdout
check('working tree is on the remote (readable on any git host)', /main\.typ/.test(remoteFiles) && /scripts\/analysis\.py/.test(remoteFiles))
check('per-hub CRDT state is on the remote', /\.collab\/crdt\/.+\.bin/.test(remoteFiles))
check('build outputs are not pushed', !/(^|\n)out\//.test(remoteFiles))

// B adopts the project from the git server alone -- no peer online, no invite
const adopted = await b.post(`/projects/${PROJ}`, { gitUrl: REMOTE, branch: 'main' })
check('B adopted the project straight from the git remote', adopted.ok === true && adopted.adopted === true)
check('adopted files present on B', await until(async () => (await b.api(`/p/${PROJ}/files`)).some(f => f.path === 'main.typ')))

// Edits made independently on both hubs, then synced through the remote only
const docA = await openDoc(a, PROJ), docB = await openDoc(b, PROJ)
const MA = `// from A ${Date.now()}`, MB = `// from B ${Date.now()}`
docA.getMap('files').get('main.typ').insert(0, MA + '\n')
docB.getMap('files').set('notes-b.typ', new Y.Text(MB))
await sleep(3000)

await a.post(`/p/${PROJ}/gitremote/sync`)      // A pushes its edit
const bPull = await b.post(`/p/${PROJ}/gitremote/sync`)   // B merges + pushes its own
check('B absorbed A\'s CRDT state on merge', bPull.ok === true && bPull.pulled >= 1)
check('A\'s edit reached B\'s disk through git',
  await until(async () => (await readFile(`${DATA_B}/${PROJ}/main.typ`, 'utf8')).includes(MA)))
const aPull = await a.post(`/p/${PROJ}/gitremote/sync`)   // A merges B's
check('A absorbed B\'s state', aPull.ok === true)
check('B\'s new file reached A\'s disk through git', await until(async () => (await readFile(`${DATA_A}/${PROJ}/notes-b.typ`, 'utf8')).includes(MB)))
check('concurrent edits both survived (no clobber)',
  (await readFile(`${DATA_A}/${PROJ}/main.typ`, 'utf8')).includes(MA) &&
  (await readFile(`${DATA_B}/${PROJ}/notes-b.typ`, 'utf8')).includes(MB))

// Notes (comments, signatures) and history travel too
docA.getMap('comments').set('c1', { file: 'main.typ', text: 'check this' })
await sleep(500)
await a.post(`/p/${PROJ}/checkpoint`, { message: 'noted' })
await a.post(`/p/${PROJ}/gitremote/sync`)
const refs = (await run('git', ['-C', REMOTE, 'for-each-ref', '--format=%(refname)', 'refs/notes'])).stdout
check('comment notes pushed under the hub namespace', /refs\/notes\/[0-9a-f]+\/comments/.test(refs))
check('project history survives on the remote', (await run('git', ['-C', REMOTE, 'log', '--format=%s', 'main'])).stdout.includes('checkpoint: project created'))

// The remote is a normal repo: a plain clone gives you the paper
await run('rm', ['-rf', '/tmp/plainclone'])
await run('git', ['clone', '-q', REMOTE, '/tmp/plainclone'])
const cloned = await readFile('/tmp/plainclone/main.typ', 'utf8')
check('a plain git clone yields the working project', cloned.includes(MA) && cloned.includes('#let R = json'))
check('no merge-conflict markers anywhere', !cloned.includes('<<<<<<<'))

// An agent (Claude Code, a script) works on a clone and pushes, while someone
// types in the same file: after the hub syncs, the editor holds both.
const { appendFile } = await import('node:fs/promises')
const g = (...a) => run('git', ['-C', '/tmp/plainclone', '-c', 'user.name=agent', '-c', 'user.email=agent@x', ...a])
await appendFile('/tmp/plainclone/summary.typ', '\nAGENT WAS HERE\n')
await g('commit', '-qam', 'agent: one line'); await g('push', '-q', 'origin', 'main')
docA.getMap('files').get('summary.typ').insert(0, '// LIVE TYPING\n')
await sleep(2500)
await a.post(`/p/${PROJ}/gitremote/sync`)
const live = () => docA.getMap('files').get('summary.typ').toString()
check('an agent\'s pushed edit reaches the live editor', await until(async () => live().includes('AGENT WAS HERE')))
check('and typing done meanwhile survives it', live().includes('// LIVE TYPING'))

// An agent editing the hub's own files on disk: merged into the live text
await appendFile(`${DATA_A}/${PROJ}/main.typ`, '\nDISK EDIT\n')
const mainA = () => docA.getMap('files').get('main.typ').toString()
check('an edit on the hub\'s disk reaches the live editor', await until(async () => mainA().includes('DISK EDIT')))
check('without losing what was there', mainA().includes(MA))

console.log(pass ? '\nGITSYNC ALL PASS' : '\nGITSYNC FAILURES')
process.exit(pass ? 0 : 1)
