// A .tar.gz or .zip into tydig: a new project from it, or an existing one
// updated by it live, and nothing in it that reaches out of the project.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
import { execFileSync as sh } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const B = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const cookie = (await fetch(`${B}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ email: 'ann@example.com', password: 'password123', name: 'ann' }) })).headers.getSetCookie()[0].split(';')[0]
const api = (p, o = {}) => fetch(`${B}/api${p}`, { ...o, headers: { cookie, origin: B, 'content-type': 'application/json', ...o.headers } }).then(r => r.json())
const imp = (n, body, name) => api(`/p/${n}/import?name=${name}`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } })

// an archive as people make them: one folder, its .git, a symlink out, a figure
const t = mkdtempSync(path.join(tmpdir(), 'tydig-imp-')), top = path.join(t, 'corona-r21')
mkdirSync(path.join(top, 'src'), { recursive: true }); mkdirSync(path.join(top, '.git'))
writeFileSync(path.join(top, 'src', 'aims.typ'), '= Specific Aims\nCorona.\n')
writeFileSync(path.join(top, 'Makefile'), 'all:\n\techo ok\n')
writeFileSync(path.join(top, '.git', 'config'), '[core]\n\tfsmonitor = touch /tmp/pwned\n')
writeFileSync(path.join(top, 'fig.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
symlinkSync('/etc/passwd', path.join(top, 'passwd'))
sh('tar', ['-czf', path.join(t, 'a.tgz'), '-C', t, 'corona-r21'])

await api('/projects/corona', { method: 'POST', body: JSON.stringify({ empty: true }) })
const r1 = await imp('corona', readFileSync(path.join(t, 'a.tgz')), 'corona-r21.tar.gz')
const files = (await api('/p/corona/files')).map(f => f.path)
check('a new project from a .tar.gz: its files, out of the folder they came in', ['src/aims.typ', 'Makefile', 'fig.png'].every(f => files.includes(f)) &&
  r1.added.length === 3)
check('never its .git, and never a symlink', !files.includes('passwd') && !existsSync('data/corona/passwd') &&
  !readFileSync('data/corona/.git/config', 'utf8').includes('pwned'))

// the same project, open in an editor, updated by an archive with one file changed
const doc = new Y.Doc()
new HocuspocusProvider({ url: 'ws://localhost:1234', name: 'corona', document: doc, token: /session_token=([^;]+)/.exec(cookie)[1], WebSocketPolyfill: WebSocket })
await sleep(1500)
writeFileSync(path.join(top, 'src', 'aims.typ'), '= Specific Aims\nCorona, revised.\n')
sh('sh', ['-c', `cd ${t} && rm -f corona-r21/passwd && zip -qr b.zip corona-r21`])
const r2 = await imp('corona', readFileSync(path.join(t, 'b.zip')), 'b.zip')
await sleep(500)
check('an update from a .zip: only what differs, and nothing deleted', r2.changed.join() === 'src/aims.typ' && r2.same === 2 && !r2.added.length)
check('it reaches the open editor live', doc.getMap('files').get('src/aims.typ')?.toString().includes('revised'))
check('as one checkpoint, so History can undo it', (await api('/p/corona/history'))[0].message === 'checkpoint: imported b.zip')

// a path out of the project, and things that are not archives
sh('python3', ['-c', `import tarfile, io
with tarfile.open('${t}/evil.tgz', 'w:gz') as z:
  for n in ['../escape.txt', 'ok/../../escape2.txt', 'fine.txt']:
    i = tarfile.TarInfo(n); d = b'x'; i.size = len(d); z.addfile(i, io.BytesIO(d))`])
const r3 = await imp('corona', readFileSync(path.join(t, 'evil.tgz')), 'evil.tgz')
check('a path out of the project is skipped, the rest lands', r3.skipped.length === 2 && r3.added.join() === 'fine.txt' &&
  !existsSync('data/escape.txt') && !existsSync('escape2.txt'))
check('a file that is not an archive is refused', /not an archive/.test((await imp('corona', Buffer.from('hello'), 'x.zip')).error || ''))

console.log(pass ? '\nIMPORT ALL PASS' : '\nIMPORT FAILURES')
process.exit(pass ? 0 : 1)
