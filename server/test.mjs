import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const B_URL = 'http://localhost:3000'
const O = B_URL

// sign up a user, get session cookie + token
const r = await fetch(`${B_URL}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: O },
  body: JSON.stringify({ email: `test${Date.now()}@t.co`, password: 'password123', name: 'Tester' }),
})
const COOKIE = r.headers.getSetCookie()[0].split(';')[0]
const TOK = /better-auth\.session_token=([^;]+)/.exec(COOKIE)[1]
const api = (p, opt = {}) => fetch(B_URL + '/api' + p,
  { ...opt, headers: { ...opt.headers, cookie: COOKIE, origin: O } }).then(r => r.json())

// create the demo project (= organization) as this user
await api('/projects/demo', { method: 'POST' })
// any text file is editable, whatever its name; binaries are not
const { writeFileSync: put, mkdirSync, rmSync, existsSync: ex } = await import('node:fs')
put('data/demo/Containerfile', 'FROM scratch\n'); put('data/demo/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
put('data/demo/blob.bin', Buffer.from([0x50, 0x00, 0x4b]))
mkdirSync('data/demo/old'); put('data/demo/old/a.typ', 'a\n'); put('data/demo/old/b.txt', 'b\n')

const mk = () => {
  const doc = new Y.Doc()
  new HocuspocusProvider({ url: 'ws://localhost:1234', name: 'demo', document: doc, token: TOK, WebSocketPolyfill: WebSocket })
  return doc
}
let pass = true
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL'), name); pass &&= cond }
const nih = async t => (await api(`/projects/${t}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ template: t }) }), (await api(`/p/${t}/files`)).map(f => f.path))
const [r21, r03] = [await nih('nih-r21'), await nih('nih-r03')]
const { readFileSync: get } = await import('node:fs')
check('templates are listed, report first', (await api('/templates'))[0] === 'report')
check('an NIH template is its shared layer plus its own grant.yaml',
  ['main.typ', 'lib/nih.typ', 'letters.typ', 'grant.yaml'].every(f => r21.includes(f) && r03.includes(f)) &&
  /code: R21/.test(get('data/nih-r21/grant.yaml', 'utf8')) && /code: R03/.test(get('data/nih-r03/grant.yaml', 'utf8')))

const A = mk(), B = mk()
await sleep(1500)
const fA = A.getMap('files'), fB = B.getMap('files')

check('template loaded into Y map', fA.has('main.typ') && fA.has('scripts/analysis.py') && fA.has('Makefile'))
check('any text file is in the CRDT (Containerfile, .svg), a binary is not',
  fA.has('Containerfile') && fA.has('logo.svg') && !fA.has('blob.bin'))
// a folder removed on the hub's disk (rm -r) leaves every editor
const had = fB.has('old/a.typ') && fB.has('old/b.txt')
rmSync('data/demo/old', { recursive: true }); await sleep(1500)
check('rm -r on disk removes the folder from the CRDT', had && ![...fB.keys()].some(p => p.startsWith('old/')))
check('deleting a disk-only file from the editor works',
  (await api('/p/demo/raw/blob.bin', { method: 'DELETE' })).ok && !ex('data/demo/blob.bin'))
check('generated build/ excluded from CRDT (disk-only)', ![...fA.keys()].some(p => p.startsWith('build/')))

// multi-file edit sync
fA.get('summary.typ').insert(0, '// edited by A\n')
fB.set('chapters/01.typ', new Y.Text('= Chapter one\n'))
await sleep(1200)
check('A edit visible to B', fB.get('summary.typ').toString().startsWith('// edited by A'))
check('B new nested file visible to A', fA.get('chapters/01.typ')?.toString() === '= Chapter one\n')

// comment anchor creep regression: comment on last 3 chars, then type after
const yt = fA.get('chapters/01.typ')
const from = yt.length - 4, to = yt.length - 1 // "one"
const rel = (i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yt, i, assoc))).toString('base64')
A.getMap('comments').set('c1', { file: 'chapters/01.typ', author: 'A', text: 'rename?', anchor: rel(from, 0), head: rel(to, -1) })
yt.insert(yt.length, 'MORE TYPED TEXT')
await sleep(300)
const abs = s => Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(s, 'base64')), A).index
const c = A.getMap('comments').get('c1')
check('comment range did not creep over new text', yt.toString().slice(abs(c.anchor), abs(c.head)) === 'one')

// autosave mirror to disk
await sleep(2800)
const { execSync } = await import('node:child_process')
const onDisk = execSync('cat data/demo/chapters/01.typ').toString()
check('nested file mirrored to disk', onDisk.includes('Chapter one'))

// checkpoint + multi-file restore: delete a file, restore brings it back
await api('/p/demo/checkpoint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'pre-delete' }) })
const hist = await api('/p/demo/history')
const cp = hist.find(h => h.message.includes('pre-delete'))
fA.delete('summary.typ')
fA.get('main.typ').insert(0, 'GARBAGE ')
const mt = fA.get('main.typ'), at = mt.toString().indexOf('Pre-registration')
A.getMap('comments').set('c2', { file: 'main.typ', anchor: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(mt, at, 0))).toString('base64'),
  head: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(mt, at + 16, -1))).toString('base64') })
fA.set('.git/config', new Y.Text('[core]\n\tfsmonitor = "touch PWNED"\n'))
await sleep(2800)
check('file deletion mirrored', !((await api('/p/demo/files')).some(f => f.path === 'summary.typ')))
await api(`/p/demo/restore/${cp.hash}`, { method: 'POST' })
await sleep(1200)
check('restore resurrected deleted file on both clients',
  fA.get('summary.typ')?.toString().startsWith('// edited by A') && fB.has('summary.typ'))
check('restore rolled back edit', !fB.get('main.typ').toString().includes('GARBAGE'))
const c2 = A.getMap('comments').get('c2')
check('restore keeps comments anchored outside the change', fA.get('main.typ').toString().slice(abs(c2.anchor), abs(c2.head)) === 'Pre-registration')
check('CRDT path cannot write .git/config', !execSync('cat data/demo/.git/config').toString().includes('fsmonitor'))
check('out/ PDFs excluded from history', !(await api('/p/demo/history')).length === false &&
  !execSync(`git -C data/demo ls-tree -r --name-only ${cp.hash}`).toString().includes('out/'))

// auth guards
const noauth = await fetch('http://localhost:3000/api/projects')
check('REST rejects missing session', noauth.status === 401)
const badDoc = new Y.Doc()
let authFailed = false
new HocuspocusProvider({ url: 'ws://localhost:1234', name: 'demo', document: badDoc, token: 'not-a-real-session', WebSocketPolyfill: WebSocket, onAuthenticationFailed: () => { authFailed = true } })
await sleep(1200)
check('websocket rejects invalid session', authFailed && badDoc.getMap('files').size === 0)

// recipes: discovered by parsing the Makefile, run in the sandbox (UNSAFE
// host mode in this CI)
const recipes = await api('/p/demo/recipes')
check('make targets listed', Array.isArray(recipes) && recipes.includes('report') && recipes.includes('analysis'))
check('file targets and .PHONY not offered as recipes',
  Array.isArray(recipes) && !recipes.some(r => r.includes('/') || r.startsWith('.')))
const build = await api('/p/demo/build/analysis', { method: 'POST' })
check('build recipe runs', build.ok === true)
const filesAfter = await api('/p/demo/files')
check('analysis output on disk', filesAfter.some(f => f.path === 'build/results.json'))
await sleep(600)
check('analysis output still not CRDT-managed', !fA.has('build/results.json'))

// symlinks (planted by a build or a git checkout) never lead out of the project
const { symlinkSync, writeFileSync, readFileSync } = await import('node:fs')
symlinkSync(`${process.cwd()}/data/auth.db`, 'data/demo/leak.bin')
writeFileSync('data/outside', 'untouched'); symlinkSync(`${process.cwd()}/data/outside`, 'data/demo/trap.typ')
check('symlink out of the project not served', (await fetch('http://localhost:3000/api/p/demo/raw/leak.bin', { headers: { cookie: COOKIE, origin: O } })).status === 400)
fA.set('trap.typ', new Y.Text('overwritten'))
await sleep(2800)
check('mirror does not write through a symlink', readFileSync('data/outside', 'utf8') === 'untouched')

// path traversal guards
const bad = await fetch('http://localhost:3000/api/p/demo/raw/../../etc/passwd')
check('raw path traversal blocked', bad.status >= 400)

console.log(pass ? '\nALL PASS' : '\nFAILURES')
process.exit(pass ? 0 : 1)
