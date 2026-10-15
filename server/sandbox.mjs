// The only door from the hub to podman: it holds the socket and runs one
// thing, a command in the build sandbox on one project, every flag fixed.
// Request: one JSON line {proj, cmd, secs, i}. Reply: with i (the LSP) a
// raw stdio pipe, else one JSON line {code, stdout, stderr}.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

// The build image is this hub's own: named by a hash of sandbox/ and fonts/,
// built at start when missing, so it can never be older than the code.
const CTX = process.env.TYDIG_BUILD_CONTEXT || path.resolve(import.meta.dirname, '..')
const tree = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(d, e.name)) : [path.join(d, e.name)]).sort()
const named = () => {
  const sum = createHash('sha256')
  for (const f of tree(path.join(CTX, 'sandbox'))) sum.update(f.slice(CTX.length)).update(readFileSync(f))
  for (const f of tree(path.join(CTX, 'fonts'))) sum.update(f.slice(CTX.length) + statSync(f).size)
  return 'localhost/tydig-build:' + sum.digest('hex').slice(0, 12)
}
const { TYDIG_DATA: DATA } = process.env
let IMAGE = process.env.TYDIG_IMAGE
const podman = (args, o) => new Promise(ok => spawn('podman', args, { stdio: 'ignore', ...o })
  .on('close', c => ok(c === 0)).on('error', () => ok(false)))
async function image() {
  if (await podman(['image', 'exists', IMAGE])) return
  console.log(`build image ${IMAGE}: building it (a few minutes, once per version)`)
  if (!await podman(['build', '-t', IMAGE, '-f', path.join(CTX, 'sandbox/Containerfile'), CTX], { stdio: 'inherit' }))
    return console.warn(`build image ${IMAGE} failed to build: builds cannot run`)
  const old = await new Promise(ok => { let o = ''; spawn('podman', ['images', '--format', '{{.Repository}}:{{.Tag}}',
    'localhost/tydig-build']).on('error', () => ok('')).stdout.on('data', d => o += d).on('end', () => ok(o)) })
  for (const t of old.split('\n').filter(t => t && t !== IMAGE)) await podman(['rmi', t])
}
const AT = process.env.TYDIG_SANDBOX || '/run/tydig/sandbox.sock'
const MAX = Number(process.env.TYDIG_MAX_SANDBOXES || 24)
// network: public HTTPS through egress, or none
const NET = process.env.TYDIG_BUILD_NET === '0' ? ['--network=none'] : ['--network=tydig-build',
  ...['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].flatMap(v => ['-e', `${v}=http://egress:3128`])]
// gVisor (runsc, put in place by `just up`): builds get a kernel of their own,
// so a kernel bug a build reaches is gVisor's, not the host's. Probed at start:
// with the host's cgroups (the limits below) if they work for it, else without.
const RT = process.env.TYDIG_RUNTIME !== 'none' && process.env.TYDIG_RUNTIME
let RUNTIME = []
const probe = flags => podman(['run', '--rm', ...flags, ...NET, '--log-driver=none', '--memory=64m', IMAGE, 'true'])
export const at = s => s.includes(':') ? [+s.split(':').pop(), s.split(':')[0]] : [s]

// The folder is pinned by inode: swapped for a symlink after this check,
// the sandbox refuses to run (gVisor shows its own inodes, so there only the
// check here holds; only the hub writes DATA). .git is never visible.
const PIN = 'test "$(stat -c %d:%i /work)" = "$0" || { echo project moved >&2; exit 97; }; exec "$@"'
const args = (proj, secs, i, cmd) => {
  const dir = path.join(DATA, proj), s = lstatSync(dir)
  if (!s.isDirectory()) throw new Error('not a project')
  return ['run', '--rm', ...i ? ['-i'] : [], ...RUNTIME, ...NET, `--timeout=${secs}`, '--log-driver=none',
    '--userns=keep-id:uid=1000,gid=1000', '--memory=2g', '--pids-limit=512', '--cpus=2',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--security-opt=label=level:s0',
    '--read-only', '--tmpfs=/tmp:rw,size=512m', '--tmpfs=/work/.git:ro,size=4k,notmpcopyup',
    '--tmpfs=/work/.collab:ro,size=4k,notmpcopyup', // the hub's state, never a build's to write
    '-e', 'HOME=/tmp', '-e', 'MPLCONFIGDIR=/tmp/mpl', '-e', 'TYPST_ROOT=/work',
    '-v', `${dir}:/work:rw,z`, '-w', '/work', IMAGE, ...RUNTIME.length ? [] : ['sh', '-c', PIN, `${s.dev}:${s.ino}`], ...cmd]
}
const ok = r => /^[\w-]{1,64}$/.test(r?.proj) && Array.isArray(r.cmd) && r.cmd.length && r.cmd.length < 64 &&
  r.cmd.every(a => typeof a === 'string' && a.length < 4096) && r.secs > 0 && r.secs <= 86400

let live = 0
const serve = sock => {
  let head = ''
  const no = e => sock.end(JSON.stringify({ code: -1, stdout: '', stderr: e }) + '\n')
  sock.on('error', () => {})
  sock.on('data', function first(d) {
    head += d
    const n = head.indexOf('\n')
    if (n < 0) return head.length > 1e6 && sock.destroy()
    sock.off('data', first); sock.pause()
    let r, a
    try { r = JSON.parse(head.slice(0, n)); if (!ok(r)) throw 0; a = args(r.proj, Math.ceil(r.secs), r.i, r.cmd) }
    catch { return no('bad sandbox request') }
    if (live >= MAX) return no('the hub is running too many sandboxes; try again shortly')
    live++
    const p = spawn('podman', a, { stdio: ['pipe', 'pipe', r.i ? 'ignore' : 'pipe'] })
    const bye = () => { try { p.kill() } catch {} }, t = setTimeout(bye, (r.secs + 15) * 1000)
    p.on('error', e => r.i ? sock.destroy() : no(`podman: ${e.message}`))
    p.on('close', () => { live--; clearTimeout(t) })
    sock.on('close', bye)
    if (r.i) {
      p.stdin.on('error', () => {}); p.stdin.write(head.slice(n + 1))
      sock.pipe(p.stdin); p.stdout.pipe(sock)
      return sock.resume()
    }
    p.stdin.end()
    const out = { stdout: '', stderr: '' }
    p.stdout.on('data', d => out.stdout.length < 8e6 && (out.stdout += d))
    p.stderr.on('data', d => out.stderr.length < 8e6 && (out.stderr += d))
    p.on('close', code => sock.end(JSON.stringify({ code, ...out }) + '\n'))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!DATA) throw new Error('set TYDIG_DATA')
  if (!AT.includes(':')) rmSync(AT, { force: true })
  IMAGE ||= named()
  await image()
  for (const f of RT ? [[], ['--runtime-flag=ignore-cgroups']] : [])
    if (await probe(['--runtime', RT, ...f])) { RUNTIME = ['--runtime', RT, ...f]; break }
  if (RT && !RUNTIME.length) console.warn(`builds are NOT under gVisor: ${RT} failed its probe`)
  net.createServer(serve).listen(...at(AT), () => console.log(`sandboxes on ${AT}, ${NET[0]}, ` +
    (RUNTIME.length ? `gVisor${RUNTIME[2] ? ' (no cgroup limits)' : ''}` : 'plain containers')))
}
