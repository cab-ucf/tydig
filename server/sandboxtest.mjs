// The sandbox service, with real rootless podman: what a build can and cannot
// touch, and what the hub can and cannot ask for. `just test-sandbox`.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const DATA = mkdtempSync(path.join(tmpdir(), 'tydig-sbx-')), SOCK = path.join(DATA, 's.sock')
mkdirSync(path.join(DATA, 'p', '.git'), { recursive: true }); writeFileSync(path.join(DATA, 'p', '.git', 'config'), 'ok\n')
mkdirSync(path.join(DATA, 'gitsync')); symlinkSync('/etc', path.join(DATA, 'evil'))
const srv = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'sandbox.mjs')],
  { env: { ...process.env, TYDIG_DATA: DATA, TYDIG_SANDBOX: SOCK, TYDIG_BUILD_NET: '0' }, stdio: 'inherit' })
await new Promise(r => setTimeout(r, 800))
const ask = (req, input) => new Promise(ok => {
  let out = ''
  const s = net.connect(SOCK).on('data', d => out += d).on('close', () => ok(input ? out : JSON.parse(out)))
  s.write(JSON.stringify(req) + '\n'); if (input) setTimeout(() => s.write(input), 300), setTimeout(() => s.end(), 4000)
})
const sh = (c, proj = 'p') => ask({ proj, cmd: ['sh', '-c', c], secs: 60 })

const r = await sh('echo built > out.txt; id -u; ls -A .git | wc -l; touch /etc/x 2>/dev/null || echo ro; ls /sys/class/net')
check('a build runs in the sandbox and writes its project', r.code === 0 && readFileSync(path.join(DATA, 'p', 'out.txt'), 'utf8') === 'built\n')
check('as uid 1000, on a read-only root, with no network', /^1000\n0\nro\nlo\n$/.test(r.stdout))
const g = await sh('echo pwned > .git/config')
check('it never sees the project\'s git (hooks and config would run on the hub)', g.code !== 0 &&
  readFileSync(path.join(DATA, 'p', '.git', 'config'), 'utf8') === 'ok\n')
for (const [n, req] of [['a symlink out of the data folder', { proj: 'evil', cmd: ['ls'], secs: 5 }],
  ['a path', { proj: '../etc', cmd: ['ls'], secs: 5 }], ['a hub folder (deploy keys)', { proj: 'gitsync', cmd: ['ls'], secs: 5 }],
  ['a podman flag instead of a command', { proj: 'p', cmd: '--privileged', secs: 5 }], ['no time limit', { proj: 'p', cmd: ['ls'], secs: 1e9 }]])
  check(`the hub cannot ask for ${n}`, (await ask(req)).stderr === 'bad sandbox request')
check('the LSP is a pipe into the sandbox', (await ask({ proj: 'p', cmd: ['cat'], secs: 60, i: true }, 'Content-Length: 2\r\n\r\n{}')) === 'Content-Length: 2\r\n\r\n{}')
check('and leaves nothing behind on the host', !existsSync(path.join(DATA, 'p', 'x')))

srv.kill()
console.log(pass ? '\nSANDBOX ALL PASS' : '\nSANDBOX FAILURES')
process.exit(pass ? 0 : 1)
