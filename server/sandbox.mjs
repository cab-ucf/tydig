// The only door from the hub to podman. This holds the podman socket; the hub
// holds a connection here and may ask for one thing: a command in the build
// sandbox, on one project. Every flag and mount is fixed below, so a hub that
// is broken into still cannot start a container that reaches the host.
//   one JSON line {proj, cmd, secs, i}, then: i (the LSP) a raw stdio pipe;
//   otherwise one JSON line back, {code, stdout, stderr}.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { lstatSync } from 'node:fs'
import path from 'node:path'

const { TYDIG_DATA: DATA, TYDIG_IMAGE: IMAGE = 'localhost/tydig-build' } = process.env
const AT = process.env.TYDIG_SANDBOX || '/run/tydig/sandbox.sock'
const MAX = Number(process.env.TYDIG_MAX_SANDBOXES || 24)
// network: filtered (the egress proxy: public HTTPS only) unless cut entirely
const NET = process.env.TYDIG_BUILD_NET === '0' ? ['--network=none'] : ['--network=tydig-build',
  ...['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].flatMap(v => ['-e', `${v}=http://egress:3128`])]
export const at = s => s.includes(':') ? [+s.split(':').pop(), s.split(':')[0]] : [s]

// The project folder is pinned by inode: had it been swapped for a symlink
// (to the host's home, say) after this check, the mount would be elsewhere,
// and the sandbox refuses before running anything. .git is never visible.
const PIN = 'test "$(stat -c %d:%i /work)" = "$0" || { echo project moved >&2; exit 97; }; exec "$@"'
const args = (proj, secs, i, cmd) => {
  const dir = path.join(DATA, proj), s = lstatSync(dir)
  if (!s.isDirectory()) throw new Error('not a project')
  return ['run', '--rm', ...(i ? ['-i'] : []), ...NET, `--timeout=${secs}`,
    '--userns=keep-id:uid=1000,gid=1000', '--memory=2g', '--pids-limit=512', '--cpus=2',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--security-opt=label=level:s0',
    '--read-only', '--tmpfs=/tmp:rw,size=512m', '--tmpfs=/work/.git:ro,size=4k,notmpcopyup',
    '-e', 'HOME=/tmp', '-e', 'MPLCONFIGDIR=/tmp/mpl', '-e', 'TYPST_ROOT=/work',
    '-v', `${dir}:/work:rw,z`, '-w', '/work', IMAGE, 'sh', '-c', PIN, `${s.dev}:${s.ino}`, ...cmd]
}
const ok = r => /^[\w-]{1,64}$/.test(r?.proj) && !/^(gitsync|federation|agents)$/i.test(r.proj) &&
  Array.isArray(r.cmd) && r.cmd.length && r.cmd.length < 64 && r.cmd.every(a => typeof a === 'string' && a.length < 4096) &&
  r.secs > 0 && r.secs <= 86400

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
    const bye = () => { try { p.kill() } catch {} }
    const t = setTimeout(bye, (r.secs + 15) * 1000)
    p.on('error', e => (r.i ? sock.destroy() : no(`podman: ${e.message}`)))
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
  const srv = net.createServer(serve)
  if (!AT.includes(':')) (await import('node:fs')).rmSync(AT, { force: true })
  srv.listen(...at(AT), () => console.log(`sandboxes on ${AT}, ${NET[0]}`))
}
