// The only door from the hub to podman: it holds the socket and runs one
// thing, a command in the build sandbox on one project, every flag fixed.
// Request: one JSON line {proj, cmd, secs, i, own}. Reply: with i (the LSP)
// a raw stdio pipe, else one JSON line {code, stdout, stderr}.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
// what podman says: {code, out, err}, killed after secs
const said = (args, secs = 60) => new Promise(ok => {
  const p = spawn('podman', args), r = { code: -1, out: '', err: '' }, t = setTimeout(() => p.kill(), secs * 1000)
  p.stdout.on('data', d => r.out += d); p.stderr.on('data', d => r.err.length < 1e5 && (r.err += d))
  p.on('error', e => r.err += e.message).on('close', c => { clearTimeout(t); ok({ ...r, code: c ?? -1 }) })
})
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
// network: public HTTPS through egress, or none (and never the host's own proxy
// settings: podman copies them in by default, and a NO_PROXY naming PyPI sends
// uv past egress, into a network with no way out)
const NONET = process.env.TYDIG_BUILD_NET === '0'
const PROXY = NONET ? [] : ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].map(v => `${v}=http://egress:3128`)
const ENV = [...PROXY, 'HOME=/tmp', 'MPLCONFIGDIR=/tmp/mpl', 'TYPST_ROOT=/work']
const NET = ['--http-proxy=false', ...NONET ? ['--network=none'] : ['--network=tydig-build']]
// gVisor (runsc and sandbox/gvisor-run, in the build image): a build's command
// runs under a kernel of its own, so a kernel bug it reaches is gVisor's, not
// the host's; gVisor hides .git and .collab itself. Its one need of the
// container is CAP_SYS_CHROOT, to set up its root; the build gets nothing.
// Probed at start; TYDIG_RUNTIME=none: plain containers.
let gvisor = false
const under = cmd => gvisor ? ['gvisor-run', NONET ? 'none' : 'host', ...cmd] : cmd
// as 1000, or in a project's image as its root (the hub's user): no capabilities
const box = (secs, own) => ['run', '--rm', ...NET, `--timeout=${secs}`, '--log-driver=none',
  ...own && !gvisor ? ['--user=0:0'] : ['--userns=keep-id:uid=1000,gid=1000'], '--memory=2g', '--pids-limit=512', '--cpus=2',
  '--cap-drop=ALL', ...gvisor ? ['--cap-add=SYS_CHROOT'] : [], '--security-opt=no-new-privileges',
  '--security-opt=label=level:s0', '--read-only', '--tmpfs=/tmp:rw,size=512m']
export const at = s => s.includes(':') ? [+s.split(':').pop(), s.split(':')[0]] : [s]

// The folder is pinned by inode: swapped for a symlink after this check,
// the sandbox refuses to run. .git is never visible.
const PIN = 'test "$(stat -c %d:%i /work)" = "$0" || { echo project moved >&2; exit 97; }; exec "$@"'
// own: the project's image (mine below); under gVisor it is the build's root
// filesystem, its environment the build's, gVisor itself still from IMAGE
const args = (proj, secs, i, cmd, own) => {
  const dir = path.join(DATA, proj), s = lstatSync(dir)
  if (!s.isDirectory()) throw new Error('not a project')
  return [...box(secs, own), ...i ? ['-i'] : [], ...gvisor ? [] : ['--tmpfs=/work/.git:ro,size=4k,notmpcopyup',
    '--tmpfs=/work/.collab:ro,size=4k,notmpcopyup'], // the hub's state, never a build's to write
    ...ENV.flatMap(e => ['-e', e]), ...own && gvisor ? [`--mount=type=image,src=${own.image},dst=/rootfs`,
      '-e', 'TYDIG_ROOT=/rootfs', '-e', `TYDIG_ENV=${JSON.stringify([...own.env, ...ENV])}`] : [],
    '-v', `${dir}:/work:rw,z`, '-w', '/work', own && !gvisor ? own.image : IMAGE,
    'sh', '-c', PIN, `${s.dev}:${s.ino}`, ...under(cmd)]
}

// A project with a Containerfile builds in its own image, as its Justfile
// does: made before each build (podman's cache makes that a moment), from the
// project less .git and .collab. Its RUN steps are podman's, not gVisor's.
// Then /root opened to all: under gVisor a build sees only files' "other" bits
// (rustup, uv tool and pip --user install there).
const mine = async proj => {
  const dir = path.join(DATA, proj), tag = `localhost/tydig-p-${proj.toLowerCase()}`, t = `/tmp/${proj}`
  if (!lstatSync(path.join(dir, 'Containerfile'), { throwIfNoEntry: false })?.isFile()) return
  const keep = ['.containerignore', '.dockerignore'].map(f => { try { return readFileSync(path.join(dir, f), 'utf8') } catch { return '' } })
  mkdirSync(t, { recursive: true }); writeFileSync(`${t}/ignore`, keep.join('\n') + '\n.git\n.collab\n')
  writeFileSync(`${t}/open`, `FROM ${tag}:src\nUSER 0\nRUN [ ! -d /root ] || chmod -R a+rX /root\n`)
  const log = await said(['build', '-q', '--http-proxy=false', ...NONET ? ['--network=none'] : [],
    '--ignorefile', `${t}/ignore`, '-t', `${tag}:src`, '-f', path.join(dir, 'Containerfile'), dir], 1800)
  if (log.code) throw new Error(`the project's Containerfile did not build:\n${log.err.replace(/^.*level=warning.*\n/gm, '')}`)
  const image = (await said(['build', '-q', '--network=none', '-t', tag, '-f', `${t}/open`, t], 600)).code ? `${tag}:src` : tag
  return { image, env: JSON.parse((await said(['image', 'inspect', '--format', '{{json .Config.Env}}', image])).out || 'null') || [] }
}
const ok = r => /^[\w-]{1,64}$/.test(r?.proj) && Array.isArray(r.cmd) && r.cmd.length && r.cmd.length < 64 &&
  r.cmd.every(a => typeof a === 'string' && a.length < 4096) && r.secs > 0 && r.secs <= 86400

let live = 0
const serve = sock => {
  let head = ''
  const no = e => sock.end(JSON.stringify({ code: -1, stdout: '', stderr: e }) + '\n')
  sock.on('error', () => {})
  sock.on('data', async function first(d) {
    head += d
    const n = head.indexOf('\n')
    if (n < 0) return head.length > 1e6 && sock.destroy()
    sock.off('data', first); sock.pause()
    let r, a
    try { r = JSON.parse(head.slice(0, n)); if (!ok(r)) throw 0; a = args(r.proj, Math.ceil(r.secs), r.i, r.cmd) }
    catch { return no('bad sandbox request') }
    if (live >= MAX) return no('the hub is running too many sandboxes; try again shortly')
    live++
    if (r.own) try { const o = await mine(r.proj); if (o) a = args(r.proj, Math.ceil(r.secs), r.i, r.cmd, o) }
    catch (e) { live--; return no(e.message) }
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
  gvisor = process.env.TYDIG_RUNTIME !== 'none'
  if (gvisor && !/gvisor/.test((await said([...box(30), '--tmpfs=/work', IMAGE, ...under(['uname', '-r'])])).out))
    gvisor = false, console.warn('builds are NOT under gVisor: it would not start here')
  net.createServer(serve).listen(...at(AT), () => console.log(`sandboxes on ${AT}, ` +
    `${NONET ? 'no network' : 'network through egress'}, ${gvisor ? 'under gVisor' : 'plain containers'}`))
}
