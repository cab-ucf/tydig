// Builds, Word export and the LSP (tinymist): all project code runs in the
// build sandbox (sandbox.mjs), never on the hub, unless TYDIG_UNSAFE_BUILDS=1.
// Targets are read from the Makefile, never by running it.
import express from 'express'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import { run, proj, inProj, building, editable, readIn } from './store.mjs'
import { at } from './sandbox.mjs'
import { QUOTA, used } from './files.mjs'

// builds on this machine itself, for development: never where a sandbox exists
const UNSAFE = process.env.TYDIG_UNSAFE_BUILDS === '1' && !process.env.TYDIG_SANDBOX
const MAX = Number(process.env.TYDIG_MAX_BUILDS || 2), PER = Number(process.env.TYDIG_MAX_USER_BUILDS || 1)
const SANDBOX = at(process.env.TYDIG_SANDBOX || 'sandbox:7000')
const DOCX = new URL('../sandbox/tydig-docx', import.meta.url).pathname

const ask = (n, cmd, secs, i, own) => {
  const s = net.connect(...SANDBOX)
  s.write(JSON.stringify({ proj: n, cmd, secs, i, own }) + '\n')
  return s
}
const inSandbox = (n, cmd, secs, own, signal) => new Promise((ok, no) => {
  let out = ''
  const s = ask(n, cmd, secs, false, own)
  signal?.addEventListener('abort', () => s.destroy(new Error('stopped')))
  s.on('data', d => out += d).on('error', no).on('end', () => {
    let r
    try { r = JSON.parse(out) } catch { r = { code: -1, stdout: '', stderr: out ? 'the build sandbox broke off its answer'
      : 'the build sandbox did not answer: it may still be making its image (minutes, once per version)' } }
    r.code === 0 ? ok(r) : no(Object.assign(new Error(r.stderr), r))
  })
})
// a build may leave nested repos (their config runs commands) or symlinks:
// both go after each run
const scrub = n => run('find', [proj(n), '-mindepth', '1', '(', '-path', `${proj(n)}/.git`, '-prune', ')',
  '-o', '(', '-name', '.git', '-prune', '-exec', 'rm', '-rf', '{}', '+', ')',
  '-o', '!', '-type', 'f', '!', '-type', 'd', '-exec', 'rm', '-f', '{}', '+']).catch(() => {}) // links, fifos
const MAKEFILES = ['Makefile', 'makefile', 'GNUmakefile']
const makefile = n => MAKEFILES.find(f => existsSync(inProj(n, f)))
// a command in the project (cwd /work in the sandbox); own: in the image of
// the project's Containerfile, if it has one
const sandboxed = (n, [cmd, ...args], secs, own, signal) => (UNSAFE
  ? run(cmd === 'tydig-docx' ? DOCX : cmd, args, { cwd: proj(n), timeout: secs * 1000,
    maxBuffer: 8e6, env: { ...process.env, TYPST_ROOT: proj(n) }, signal })
  : inSandbox(n, [cmd, ...args], secs, own, signal)).finally(() => scrub(n))
// one build at a time per project, TYDIG_MAX_USER_BUILDS per person,
// TYDIG_MAX_BUILDS in all; stopped once its project passes its quota
const runs = new Map() // user -> builds running
async function exec(n, cmd, own, u) {
  if (building.has(n)) throw Object.assign(new Error('a build is already running'), { status: 409 })
  if (building.size >= MAX) throw Object.assign(new Error('the hub is busy; try again shortly'), { status: 429 })
  if (runs.get(u) >= PER) throw Object.assign(new Error('you have a build running; try again when it ends'), { status: 429 })
  building.add(n); runs.set(u, (runs.get(u) || 0) + 1)
  const ac = new AbortController(), full = async () => await used(n) > QUOTA
  const t = setInterval(async () => await full() && ac.abort(), 5000)
  try { const r = await sandboxed(n, cmd, 180, own, ac.signal); if (!await full()) return r }
  catch (e) { if (!ac.signal.aborted) throw e }
  finally { clearInterval(t); building.delete(n); runs.set(u, runs.get(u) - 1) }
  throw Object.assign(new Error(`the build took the project past its ${QUOTA / 2 ** 20} MB ` +
    'limit (TYDIG_QUOTA_MB): delete some of what it wrote'), { status: 413 })
}
const why = e => typeof e.code === 'string' || /image not known|initializing source/.test(e.stderr)
  ? 'the build sandbox is not running or has no image: `just` on the hub starts it'
  : (e.stdout || '') + (e.stderr || e.message) + missing(e.stderr)
// a command the sandbox lacks: either tydig ships it and this hub's image is
// older than its code, or the project needs it added to sandbox/Containerfile
const missing = t => (t = /^(?:make: (\S+): No such file or directory|\/bin\/sh: \d+: (\S+): not found)$/m
  .exec(t || '')?.slice(1).find(Boolean)) ?
  `\n\`${t}\` is not in this hub's build sandbox. If sandbox/Containerfile installs it, the hub's image ` +
  'is older than its code: `just up` on the hub rebuilds it. If not, add it there, or give the project a Containerfile.' : ''

async function recipes(n) {
  const f = makefile(n)
  if (!f) return (await sandboxed(n, ['just', '--summary'], 30)).stdout.trim().split(/\s+/).filter(Boolean)
  const phony = new Set(), out = new Set()
  for (const l of String(await readIn(n, f).catch(() => '')).split('\n')) {
    const ph = /^\.PHONY\s*:\s*(.*)$/.exec(l)
    if (ph) ph[1].split(/\s+/).forEach(t => phony.add(t))
    for (const t of /^([\w.\/ -]+?)\s*&?:(?!=)/.exec(l)?.[1].split(/\s+/) || [])
      if (/^\w[\w-]{0,63}$/.test(t)) out.add(t)
  }
  return [...out].sort((a, b) => phony.has(b) - phony.has(a)) // .PHONY verbs first
}

export const router = express.Router({ mergeParams: true })
// sent past index.mjs's path filter: unsafe builds run tinymist on this
// machine, so the editor names files by their real path (development only)
router.get('/info', (req, res) => res.type('json').send(JSON.stringify({
  root: UNSAFE ? proj(req.params.proj) : '/work', tool: makefile(req.params.proj) ? 'make' : 'just' })))
router.get('/recipes', async (req, res) =>
  res.json(await recipes(req.params.proj).catch(e => ({ error: why(e) }))))
router.post('/build/:recipe', async (req, res) => {
  const n = req.params.proj, r = req.params.recipe
  if (!/^\w[\w-]{0,63}$/.test(r)) return res.status(400).json({ error: 'bad recipe' })
  const cmd = makefile(n) ? ['make', ...UNSAFE ? [] : ['-C', '/work'], r] : ['just', r]
  try { const o = await exec(n, cmd, true, req.user.id); res.json({ ok: true, output: o.stdout + o.stderr }) }
  catch (e) { res.status(e.status || 200).json({ ok: false, output: why(e) }) }
})
// Word, its citations live EndNote fields: out/<file>.docx
router.post('/docx', async (req, res) => {
  const n = req.params.proj, f = req.body?.file
  if (!editable(f) || !f.endsWith('.typ') || !existsSync(inProj(n, f)))
    return res.status(400).json({ ok: false, output: 'not a .typ file of this project' })
  try { res.json({ ok: true, path: (await exec(n, ['tydig-docx', f], false, req.user.id)).stdout.trim().split('\n').pop() }) }
  catch (e) { res.status(e.status || 200).json({ ok: false, output: why(e) }) }
})

// LSP over a websocket: JSON messages <-> tinymist's Content-Length frames.
// At most TYDIG_MAX_LSP at once, two per person.
const wss = new WebSocketServer({ noServer: true })
const MAX_LSP = Number(process.env.TYDIG_MAX_LSP || 8), per = new Map()
export const lspOpen = new Map() // proj -> sockets, closed when a member is removed
export function lsp(req, sock, head, n, user) {
  const count = [...per.values()].reduce((a, b) => a + b, 0)
  if (count >= MAX_LSP || (per.get(user) || 0) >= 2) return sock.destroy()
  wss.handleUpgrade(req, sock, head, ws => {
    const open = lspOpen.get(n) ?? lspOpen.set(n, new Set()).get(n)
    const p = UNSAFE ? spawn('tinymist', ['lsp'], { cwd: proj(n), stdio: ['pipe', 'pipe', 'ignore'] })
      : (s => ({ stdin: s, stdout: s, on: s.on.bind(s), kill: () => s.destroy() }))(ask(n, ['tinymist', 'lsp'], 86400, true))
    open.add(ws); per.set(user, (per.get(user) || 0) + 1)
    p.on('close', () => { per.set(user, per.get(user) - 1); ws.close() })
    p.on('error', () => ws.close(1011, 'tinymist unavailable'))
    p.stdin.on('error', () => ws.close())
    ws.on('close', () => { open.delete(ws); try { p.kill() } catch {} })
    ws.on('message', m => {
      if (p.stdin.writable) p.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${m.length}\r\n\r\n`), m]))
    })
    let buf = Buffer.alloc(0)
    p.stdout.on('data', d => {
      buf = Buffer.concat([buf, d])
      for (let sep; (sep = buf.indexOf('\r\n\r\n')) >= 0;) {
        const len = +(/content-length: *(\d+)/i.exec(buf.subarray(0, sep))?.[1] ?? 0), end = sep + 4 + len
        if (buf.length < end) return
        ws.send(buf.subarray(sep + 4, end).toString()); buf = buf.subarray(end)
      }
    })
  })
}
