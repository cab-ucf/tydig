// tydig server v2
// Project = git repo at data/<proj>/. Text files live in a Yjs map ('files':
// path -> Y.Text) mirrored to disk on autosave; binaries (images, built PDFs)
// live disk-only. Builds run `make <target>` (or `just <recipe>`) in the project dir.
import { Server } from '@hocuspocus/server'
import express from 'express'
import * as Y from 'yjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile, readdir, rm, stat, lstat, realpath, rename } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, constants as FS } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

const run = promisify(execFile)
// Project store. TYDIG_DATA must be an absolute path when the server runs
// in a container and delegates builds to the host's podman: the host mounts
// the project dir by the path the server names, so both sides must agree.
const DATA = path.resolve(process.env.TYDIG_DATA || 'data')

// ---------- auth: better-auth sessions + organization-based project access ----------
await mkdir(DATA, { recursive: true })
import { auth, authorizeProject, userProjects } from './auth.mjs'

// Validate a session from request headers (cookie). Returns {user,session}|null.
const sessionFrom = async headers => auth.api.getSession({ headers }).catch(() => null)
console.log('auth ready (email/password + project sharing via organizations)')


// ---------- sandboxed builds ----------
const IMAGE = process.env.TYDIG_IMAGE || 'localhost/tydig-build'
const UNSAFE = process.env.TYDIG_UNSAFE_BUILDS === '1'
// Network is ON by default: collaborators already run arbitrary computation
// (Typst is turing-complete) and have full project access; the sandbox's job
// is protecting the host. TYDIG_BUILD_NET=0 restores --network=none
// (recommended on cloud hosts where the metadata service is reachable).
const NET = process.env.TYDIG_BUILD_NET === '0' ? ['--network=none'] : []
// just is never run on the host unless UNSAFE: even `just --summary`
// evaluates backtick assignments in the justfile (code execution).
// keep-id: the hub's user is uid 1000 inside, so a build can write the
// project that user owns (rootless podman otherwise maps 1000 to a subuid).
// --timeout: conmon kills the container even if the podman client dies.
const sandboxArgs = (dir, secs, ...extra) => ['run', '--rm', ...NET, `--timeout=${secs}`, ...extra,
  '--userns=keep-id:uid=1000,gid=1000', '--memory=2g', '--pids-limit=512', '--cpus=2',
  '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
  '--read-only', '--tmpfs', '/tmp:rw,size=512m',
  '-e', 'HOME=/tmp', '-e', 'MPLCONFIGDIR=/tmp/mpl', '-e', 'TYPST_PACKAGE_CACHE_PATH=/opt/typst-packages',
  // .git read-only: hooks or config written by a build would run on the host at the next commit
  '-v', `${dir}:/work:rw,z`, '-v', `${dir}/.git:/work/.git:ro,z`, '-w', '/work', IMAGE]
const building = new Set() // one build at a time per project
const MAX_BUILDS = Number(process.env.TYDIG_MAX_BUILDS || 2)
// Recipes run in the sandbox: `make <target>` when the project has a
// Makefile, `just <recipe>` when it has a justfile. make is the default for
// new projects because it rebuilds only what the change actually invalidated
// -- edit prose and only Typst reruns; edit the analysis and the results,
// figures, and PDFs regenerate.
const runner = (name, args, timeout = 180_000) => {
  const tool = runnerTool(name)
  const argv = tool === 'make' ? ['-C', '/work', ...args] : args
  return UNSAFE
    ? run(tool, args, { cwd: proj(name), timeout, maxBuffer: 8e6 })
    : run('podman', [...sandboxArgs(proj(name), timeout / 1000), tool, ...argv], { timeout: timeout + 10_000, maxBuffer: 8e6 })
}
const runnerTool = name => {
  for (const f of ['Makefile', 'makefile', 'GNUmakefile']) if (existsSync(inProj(name, f))) return 'make'
  return 'just'
}
// Target discovery is done by *reading* the build file, never by running it:
// `just --summary` evaluates backtick assignments, and `make -p` runs
// $(shell ...) -- both are code execution just to populate a dropdown.
async function listRecipes(name) {
  const tool = runnerTool(name)
  if (tool === 'make') {
    const file = ['Makefile', 'makefile', 'GNUmakefile'].find(f => existsSync(inProj(name, f)))
    const text = await readFile(inProj(name, file), 'utf8')
    const out = []
    const phony = new Set()
    for (const line of text.split('\n')) {
      const ph = /^\.PHONY\s*:\s*(.*)$/.exec(line)
      if (ph) { ph[1].split(/\s+/).filter(Boolean).forEach(t => phony.add(t)); continue }
      // "targets: deps" or grouped "targets &: deps"; skip rules, variables,
      // pattern rules and paths -- what's left is what a person would type.
      const m = /^([A-Za-z0-9_.\/ -]+?)\s*&?:(?!=)/.exec(line)
      if (!m) continue
      for (const t of m[1].trim().split(/\s+/)) {
        if (t.startsWith('.') || t.includes('%') || t.includes('/') || !okRecipe(t)) continue
        if (!out.includes(t)) out.push(t)
      }
    }
    // .PHONY entries first: they are the human-facing verbs
    return out.sort((a, b) => (phony.has(b) ? 1 : 0) - (phony.has(a) ? 1 : 0))
  }
  const outp = await runner(name, ['--summary'], 30_000)
  return outp.stdout.trim().split(/\s+/).filter(Boolean)
}
// Any file that is text is edited in the CRDT, whatever its name (a
// Containerfile, an .svg, a script): UTF-8, no NUL byte, under 1 MB.
// Anything else -- images, PDFs, big data -- is a disk file.
const utf8 = new TextDecoder('utf-8', { fatal: true })
const textOf = b => { if (b.length >= 1e6 || b.includes(0)) return null; try { return utf8.decode(b) } catch { return null } }
// Generated directories are disk-only, owned by builds: they never enter the
// CRDT (so a rebuilt build/results.json is not clobbered by a stale editor
// copy) and reach previews via the raw-file shadow map instead.
const GENERATED = /^(out|build|figures)\//
const okName = n => /^[\w-]{1,64}$/.test(n)
const okHash = h => /^[0-9a-f]{7,40}$/.test(h)
const okPath = p => typeof p === 'string' && p.length < 256 && /^[\w./@ -]+$/.test(p) &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
const okRecipe = r => /^[\w-]{1,64}$/.test(r)
const proj = n => path.join(DATA, n)
const inProj = (n, p) => path.join(proj(n), p)
const gitQ = new Map()
// Never wait on a person (a credential prompt) or forever (a stalled remote):
// the queue below is per project, so one stuck call would stop its autosaves.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' }
const git = (n, ...a) => {
  const r = (gitQ.get(n) || Promise.resolve()).then(() => run('git', ['-C', proj(n), ...a], { maxBuffer: 1 << 28, timeout: 600_000, env: GIT_ENV }))
  gitQ.set(n, r.catch(() => {}))
  return r.then(r => r.stdout)
}
// Symlinks (from a build or a git checkout) must never lead the server out of the project.
const safe = async (n, rel) => {
  const f = inProj(n, rel), d = await realpath(path.dirname(f)).catch(() => '')
  if (!(d + path.sep).startsWith(await realpath(proj(n)) + path.sep) || (await lstat(f).catch(() => null))?.isSymbolicLink())
    throw Object.assign(new Error('bad path'), { status: 400 })
  return f
}
const NOFOLLOW = FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | (FS.O_NOFOLLOW || 0)
// Replace a Y.Text's content with a minimal edit, so comment anchors and
// concurrent edits outside the changed span survive. Never splits a surrogate pair.
const setText = (t, s) => {
  const o = t.toString(), hi = i => (o.charCodeAt(i) & 0xFC00) === 0xD800
  if (o === s) return
  let a = 0, b = 0
  while (a < o.length && o[a] === s[a]) a++
  if (a && hi(a - 1)) a--
  while (b < o.length - a && b < s.length - a && o[o.length - 1 - b] === s[s.length - 1 - b]) b++
  if (b && hi(o.length - b - 1)) b--
  t.delete(a, o.length - a - b); t.insert(a, s.slice(a, s.length - b))
}
// This hub's CRDT state, inside .git: never committed, gone with the project.
const crdtFile = n => path.join(proj(n), '.git', 'tydig-crdt')

async function ensureRepo(name) {
  if (existsSync(path.join(proj(name), '.git'))) return
  await mkdir(proj(name), { recursive: true })
  await git(name, 'init', '-q', '-b', 'main')
  await git(name, 'config', 'user.email', 'collab@localhost')
  await git(name, 'config', 'user.name', 'tydig')
}

async function* walk(dir, base = dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    // .collab holds hub machinery (per-hub CRDT state for git sync), not
    // project content: never listed, never mirrored, never in the CRDT.
    if (e.name === '.git' || e.name === '.collab' || e.isSymbolicLink()) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, base)
    else yield path.relative(base, p).replaceAll('\\', '/')
  }
}

const written = new Map() // proj -> Set of text paths we mirror (for deletions)
const mirroring = new Set()

async function mirror(name, document) {
  mirroring.add(name)
  try {
    await ensureRepo(name)
    const cur = new Set()
    for (const [rel, t] of document.getMap('files')) {
      if (!okPath(rel) || GENERATED.test(rel)) continue
      await mkdir(path.dirname(inProj(name, rel)), { recursive: true })
      await safe(name, rel).then(f => writeFile(f, t.toString(), { flag: NOFOLLOW })).catch(e => console.warn(`mirror: skipped ${rel} (${e.message})`))
      cur.add(rel)
    }
    for (const old of written.get(name) ?? [])
      if (!cur.has(old) && okPath(old) && !GENERATED.test(old)) await safe(name, old).then(f => rm(f, { force: true })).catch(() => {})
    written.set(name, cur)
  } finally { setTimeout(() => mirroring.delete(name), 300) }
}

// 'typst watch' for the whole project: when anything on disk changes (a build
// regenerating figures, a shell edit, another collaborator's build), bump a
// revision counter through the CRDT; every client refreshes its preview.
import { watch } from 'node:fs'
const watchers = new Map()
function watchProject(name, document) {
  if (watchers.has(name)) return
  let t
  const seen = new Set()
  const w = watch(proj(name), { recursive: true }, (_ev, fname) => {
    if (!fname || fname.startsWith('.git') || mirroring.has(name)) return
    seen.add(fname.replaceAll('\\', '/'))
    clearTimeout(t)
    t = setTimeout(async () => {
      // A new text file (copied in, pulled, written by a script) becomes
      // editable at once. Files already in the CRDT are left to it: the
      // editors may be ahead of what is on disk.
      const files = document.getMap('files'), add = []
      for (const rel of seen) {
        if (files.has(rel) || !okPath(rel) || GENERATED.test(rel)) continue
        const b = await safe(name, rel).then(f => readFile(f)).catch(() => null)
        const text = b && textOf(b)
        if (text != null) add.push([rel, text])
      }
      seen.clear()
      document.transact(() => { for (const [rel, text] of add) files.has(rel) || files.set(rel, new Y.Text(text)) })
      document.getMap('meta').set('diskRev', Date.now())
    }, 400)
  })
  watchers.set(name, w)
}

const hocuspocus = Server.configure({
  port: 1234,
  debounce: 2000,
  async onAuthenticate({ token, requestHeaders, documentName }) {
    if (!originOk(requestHeaders?.origin)) throw new Error('untrusted origin')
    const headers = new Headers()
    if (requestHeaders?.cookie) headers.set('cookie', requestHeaders.cookie)
    else if (token) headers.set('cookie', `better-auth.session_token=${token}`)
    const sess = await sessionFrom(headers)
    if (!sess?.user) throw new Error('unauthorized')
    if (!await authorizeProject(headers, documentName)) throw new Error('forbidden: not a member of this project')
    return { user: { id: sess.user.id, name: sess.user.name } }
  },
  async onLoadDocument({ documentName: name, document }) {
    if (!okName(name) || !existsSync(proj(name))) return document
    const files = document.getMap('files')
    if (files.size) return document
    // The CRDT is the identity of the document; the working tree is a
    // rendering of it. Load this hub's saved state and every peer hub's
    // (.collab/crdt/, from git sync). Seeding from text instead would mint
    // fresh Yjs types, and edits made against the old ones -- by an offline
    // browser or a peer hub -- would lose the merge and vanish.
    const dir = inProj(name, '.collab/crdt')
    const peers = existsSync(dir) ? (await readdir(dir)).filter(f => f.endsWith('.bin')).map(f => path.join(dir, f)) : []
    for (const f of [crdtFile(name), ...peers].filter(existsSync))
      try { Y.applyUpdate(document, new Uint8Array(await readFile(f)), 'crdt-load') }
      catch (e) { console.warn(`crdt state ${f} unreadable: ${e.message}`) }
    // Text the CRDT lacks, or that was edited outside the app since the last
    // save (a shell, a plain git checkout), is taken from disk.
    const saved = existsSync(crdtFile(name)) ? (await stat(crdtFile(name))).mtimeMs : Infinity
    const texts = []
    for await (const rel of walk(proj(name))) {
      if (!okPath(rel) || GENERATED.test(rel)) continue
      const f = inProj(name, rel), s = await stat(f)
      if (s.size >= 1e6 || (files.has(rel) && s.mtimeMs <= saved)) continue
      const t = textOf(await readFile(f))
      if (t != null) texts.push([rel, t])
    }
    document.transact(() => { for (const [rel, c] of texts) files.has(rel) ? setText(files.get(rel), c) : files.set(rel, new Y.Text(c)) })
    written.set(name, new Set(files.keys()))
    watchProject(name, document)
    return document
  },
  async afterUnloadDocument({ documentName: name }) {
    watchers.get(name)?.close()
    watchers.delete(name)
  },
  onStoreDocument: ({ documentName: name, document }) => store(name, document),
})
// State first, then the working tree: a crash in between leaves the disk
// older than the state, which the next load correctly ignores.
async function store(name, document) {
  if (!okName(name) || !existsSync(proj(name))) return
  await ensureRepo(name)
  const tmp = `${crdtFile(name)}.${randomBytes(4).toString('hex')}`
  await writeFile(tmp, Y.encodeStateAsUpdate(document))
  await rename(tmp, crdtFile(name))
  await mirror(name, document)
  await git(name, 'add', '-A')
  await git(name, 'commit', '-q', '-m', 'autosave').catch(() => {})
  gitsync.markDirty(name)
}
// Hub-to-hub sync over iroh (see federation.mjs). Off with TYDIG_IROH=0.
import { createFederation } from './federation.mjs'
const federation = createFederation({ hocuspocus, dataDir: DATA, okName })

// Git remotes as the durable store (see gitsync.mjs): any git host keeps the
// project safe while every hub is offline.
import { createGitSync } from './gitsync.mjs'
// Every hub needs a stable, unique id of its own: it names this hub's CRDT
// file in the shared git remote, and two hubs sharing an id would overwrite
// each other's state. Persisted locally, so it holds with iroh on or off.
const hubIdFile = path.join(DATA, 'hub-id')
if (!existsSync(hubIdFile)) writeFileSync(hubIdFile, randomBytes(8).toString('hex') + '\n')
const localHubId = readFileSync(hubIdFile, 'utf8').trim()
const gitsync = createGitSync({
  hocuspocus, dataDir: DATA, proj, git, mirror, okName,
  hubId: () => localHubId,
})

// The sync server also shares the main HTTP port at /sync (see below), which
// is what lets a single container serve the whole app with no reverse proxy.
// The dedicated :1234 listener stays on for the dev proxy and existing tests;
// set TYDIG_SYNC_PORT=0 to run single-port only.
const SYNC_PORT = process.env.TYDIG_SYNC_PORT === '0' ? null : 1234
if (SYNC_PORT) hocuspocus.listen()

// ---------- project template ----------
// New projects are scaffolded from server/template/: a pre-registered report
// whose every number and conclusion is computed from build/results.json.
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template')

// ---------- REST ----------
import { toNodeHandler } from 'better-auth/node'
import { fromNodeHeaders } from 'better-auth/node'
import compression from 'compression'
import { trustedOrigins } from './auth.mjs'
const TRUSTED = trustedOrigins()
const app = express()
// Behind a reverse proxy, TYDIG_TRUST_PROXY (hop count, 'loopback', or IPs)
// lets req.ip see the real client, which is what sign-in rate limits key on.
const TP = process.env.TYDIG_TRUST_PROXY
app.set('trust proxy', isNaN(TP) ? TP ?? false : +TP)
app.disable('x-powered-by')
// Link connections (link.mjs) reach the hub only from our own page over iroh:
// no other site can send on them, so they count as the hub's own origin.
app.use((req, res, next) => { if (req.socket.link) req.headers.origin = TRUSTED[0]; next() })
app.use(compression())
// The preview is compiler-made SVG inserted into the page; a link or image a
// collaborator writes must never run script with another's session and keys.
// No inline script, handlers or javascript: URLs. ('unsafe-eval' only because
// the typst compiler's wasm calls new Function('return 0').)
// Sync's websocket is named outright: Safari's 'self' does not cover ws(s).
const HTTPS = /^https:/.test(process.env.TYDIG_URL || '')
const CSP = `default-src 'self'; connect-src 'self' ${TRUSTED.map(o => o.replace(/^http/, 'ws')).join(' ')}; ` +
  "script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
app.use((req, res, next) => (res.set({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  ...HTTPS && { 'Strict-Transport-Security': 'max-age=31536000' },
}), next()))

// better-auth's own endpoints (sign-up/in/out, session, organizations,
// invitations) — mounted before express.json so it can read raw bodies.
// "Invalid origin" is a config mismatch, not a bug, and the bare message
// gives you nothing to act on. Say which origin was refused and what is
// actually trusted, in the log and in the response.
// Mirrors better-auth's matcher: exact origin match, or a wildcard pattern
// such as '*' or 'http://localhost:*'. Getting this wrong here would reject
// requests better-auth would have allowed.
const originAllowed = origin => TRUSTED.some(p => p.includes('*') || p.includes('?')
  ? new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(origin)
  : p === origin)
const originOk = o => !o || originAllowed(o)

app.all('/api/auth/*splat', (req, res, next) => {
  // Projects are organizations keyed by slug == directory. Only the server
  // may mint, rename or delete one: a slug chosen over HTTP could claim an
  // internal directory (gitsync/, federation/) or an orphaned project.
  if (/^\/api\/auth\/organization\/(create|update|delete)\b/.test(req.path))
    return res.status(403).json({ error: 'projects are created and removed through tydig' })
  const origin = req.headers.origin
  if (origin && !originAllowed(origin)) {
    console.warn(`auth request refused: origin ${origin} is not trusted.\n` +
      `  trusted: ${TRUSTED.join(', ')}\n` +
      `  open the app at one of those, or set TYDIG_URL and ` +
      `TYDIG_ORIGINS to ${origin} and restart.`)
    return res.status(403).json({
      code: 'INVALID_ORIGIN',
      message: `This server does not trust ${origin}. It trusts: ${TRUSTED.join(', ')}. ` +
        `Open the app at one of those addresses, or set TYDIG_URL and ` +
        `TYDIG_ORIGINS to ${origin} and restart the server.`,
      origin, trusted: TRUSTED,
    })
  }
  req.headers['x-tydig-ip'] = req.ip
  next()
}, toNodeHandler(auth))

// Cookies are SameSite=Lax, which still lets a sibling subdomain (any page
// on *.your-university.edu) forge requests. Refuse untrusted origins.
// GET is exempt, except the bridge: opening one starts a sync or LSP session.
app.use('/api', (req, res, next) => (req.method === 'GET' && req.path !== '/bridge') || originOk(req.headers.origin) ? next() : res.status(403).json({ error: 'untrusted origin' }))
app.use(express.json())

// Public: tells the login screen whether an institutional SSO is configured.
import { ssoInfo, db as authDb } from './auth.mjs'
const STARTED_AT = new Date().toISOString()
import { initKeyStore, verify as provVerify, keyIdOf, sha256hex, canon, ALG } from './prov.mjs'
const keyStore = initKeyStore(authDb)
app.get('/api/auth-config', (req, res) => res.json({
  sso: ssoInfo && { providerId: ssoInfo.providerId, label: ssoInfo.label, only: ssoInfo.only },
  // Diagnostics: lets the login screen say "you are at X, this server trusts
  // Y" before a single request is refused, and gives `just doctor` the truth
  // from the running process rather than from a config file.
  trustedOrigins: TRUSTED,
  yourOrigin: req.headers.origin || null,
  originOk: originOk(req.headers.origin),
  startedAt: STARTED_AT,
}))

// Everything else under /api requires a valid session.
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  const sess = await sessionFrom(fromNodeHeaders(req.headers))
  if (!sess?.user) return res.status(401).json({ error: 'not signed in' })
  req.user = sess.user
  req.authHeaders = fromNodeHeaders(req.headers)
  next()
})

app.get('/api/me', (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }))
app.get('/api/link', (req, res) => res.json({ link: LINK }))

// Websockets for link visitors, whose page reaches the hub only by request and
// response (link.mjs): a GET opens the socket here and streams its messages down
// as [type u8][length u32][bytes] frames; each POST carries one message up.
const bridges = new Map()
app.get('/api/bridge', (req, res) => {
  const { path: to = '', id = '' } = req.query
  if (!/^\/(sync|lsp)\b/.test(to) || !/^\w{16,64}$/.test(id) || bridges.has(id)) return res.sendStatus(400)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${to}`, { headers: { cookie: req.headers.cookie || '', origin: TRUSTED[0] } })
  bridges.set(id, { ws, user: req.user.id })
  const frame = (type, d) => { if (res.writableEnded) return; const h = Buffer.alloc(5); h[0] = type; h.writeUInt32BE(d.length, 1); res.write(Buffer.concat([h, d])) }
  res.on('error', () => ws.terminate())
  ws.on('open', () => res.writeHead(200, { 'content-type': 'application/octet-stream' }).flushHeaders())
  ws.on('message', (d, binary) => frame(binary ? 2 : 1, Buffer.from(d)))
  ws.on('error', () => res.headersSent || res.sendStatus(502))
  ws.on('close', () => res.end())
  res.on('close', () => { ws.terminate(); bridges.delete(id) })
})
app.post('/api/bridge/:id', express.raw({ type: () => true, limit: '64mb' }), (req, res) => {
  const b = bridges.get(req.params.id)
  if (b?.user !== req.user.id) return res.sendStatus(404)
  b.ws.send(req.body ?? Buffer.alloc(0), { binary: req.get('x-binary') === '1' })
  res.sendStatus(204)
})

// ---- device signing keys (post-quantum checkpoint provenance) ----
// A browser registers its locally generated ML-DSA-65 public key once; the
// secret never leaves the device. One user may hold many device keys.
app.post('/api/keys', (req, res) => {
  try {
    const { publicKey, label, proof } = req.body || {}
    res.json(keyStore.register(req.user.id, publicKey, label, proof))
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/api/keys', (req, res) => res.json(keyStore.listFor(req.user.id)))
app.get('/api/federation', async (req, res) => res.json(await federation.status()))

// Projects the signed-in user can access (their organizations, slug == dir).
app.get('/api/projects', async (req, res) => {
  const orgs = await userProjects(req.authHeaders)
  const names = (await readdir(DATA, { withFileTypes: true }).catch(() => []))
    .filter(e => e.isDirectory()).map(e => e.name)
  res.json(names.filter(n => orgs.has(n)).map(n => ({ name: n, role: orgs.get(n).role || 'member' })))
})

app.post('/api/projects/:name', async (req, res) => {
  const n = req.params.name
  // gitsync/ and federation/ beside the projects hold the hub's own settings
  if (!okName(n) || /^(gitsync|federation)$/i.test(n)) return res.status(400).json({ error: 'bad project name' })
  if (existsSync(proj(n))) return res.status(409).json({ error: 'a project with that name exists' })
  // Create the owning organization first; if the slug is taken globally, bail.
  const org = await auth.api.createOrganization({
    headers: req.authHeaders, body: { name: n, slug: n },
  }).catch(e => ({ error: e?.message || 'could not create project org' }))
  if (!org || org.error) return res.status(409).json({ error: org?.error || 'name unavailable' })
  await ensureRepo(n)
  // Joining a federated project: start EMPTY and let sync populate it. Files
  // are keyed by path in a Y.Map, so if both hubs scaffolded the same template
  // independently the two copies of each file would conflict rather than
  // merge -- identical text, but two histories. An empty start avoids that.
  const invite = req.body?.invite
  const gitUrl = req.body?.gitUrl
  if (gitUrl) {
    // Restore or join a project whose durable copy lives on a git host. This
    // is the path that needs no peer online at all.
    try { await gitsync.adopt(n, gitUrl, req.body?.branch) }
    catch (e) { // leave nothing behind, so a corrected URL can be tried under the same name
      await rm(proj(n), { recursive: true, force: true })
      await auth.api.deleteOrganization({ headers: req.authHeaders, body: { organizationId: org.id } }).catch(() => {})
      return res.status(400).json({ error: `could not adopt ${gitUrl}: ${e.message}` })
    }
    return res.json({ ok: true, adopted: true })
  }
  if (!invite) {
    await cp(TEMPLATE_DIR, proj(n), { recursive: true })
    await git(n, 'add', '-A')
    await git(n, 'commit', '-q', '-m', 'checkpoint: project created')
  } else {
    await git(n, 'commit', '-q', '--allow-empty', '-m', 'checkpoint: joined federated project')
    try { await federation.link(n, invite) }
    catch (e) { return res.status(400).json({ error: `project created but could not link: ${e.message}` }) }
  }
  res.json({ ok: true, federated: !!invite })
})

const p = express.Router({ mergeParams: true })
app.use('/api/p/:proj', async (req, res, next) => {
  if (!okName(req.params.proj) || !existsSync(proj(req.params.proj)))
    return res.status(404).json({ error: 'no such project' })
  if (!(req.org = await authorizeProject(req.authHeaders, req.params.proj)))
    return res.status(403).json({ error: 'you do not have access to this project' })
  next()
}, p)
const wild = req => {
  const rel = req.params.rel.join('/')
  if (!okPath(rel)) throw Object.assign(new Error('bad path'), { status: 400 })
  return rel
}

p.get('/files', async (req, res) => {
  const out = []
  for await (const rel of walk(proj(req.params.proj))) {
    const s = await stat(inProj(req.params.proj, rel))
    out.push({ path: rel, size: s.size, mtime: s.mtimeMs })
  }
  res.json(out)
})

// Uploads are served as sandboxed documents: an .html or .svg a collaborator
// uploads must not run script in everyone else's session. PDFs are exempt:
// browsers refuse to show them sandboxed, and their viewers run no page script.
p.get('/raw/*rel', async (req, res) => {
  const rel = wild(req)
  if (!/\.pdf$/i.test(rel)) res.set('Content-Security-Policy', 'sandbox')
  res.sendFile(await safe(req.params.proj, rel))
})

// any body: browsers send no Content-Type for extensions they don't know (.dat, .npy, .h5)
p.put('/raw/*rel', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  const rel = wild(req)
  await mkdir(path.dirname(inProj(req.params.proj, rel)), { recursive: true })
  await writeFile(await safe(req.params.proj, rel), req.body ?? '', { flag: NOFOLLOW })
  res.json({ ok: true })
})

// Sharing: an owner or admin adds an account, or invites an address that has
// none yet. Nothing sends mail: the invitation is what lets that address sign
// up, and the project is waiting when it does.
p.post('/members', async (req, res) => {
  if (!['owner', 'admin'].includes(req.org.role)) return res.status(403).json({ error: 'only the owner can share this project' })
  const email = String(req.body?.email || '').trim()
  const u = authDb.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(email)
  if (u) await auth.api.addMember({ body: { userId: u.id, organizationId: req.org.id, role: 'member' } })
  else await auth.api.createInvitation({ headers: req.authHeaders, body: { email, role: 'member', organizationId: req.org.id } })
  res.json({ ok: true, invited: !u })
})
// Removal through the hub, not better-auth directly, so it takes effect now:
// every editor reconnects and re-authenticates, and the removed one cannot.
p.delete('/members/:id', async (req, res) => {
  await auth.api.removeMember({ headers: req.authHeaders, body: { memberIdOrEmail: req.params.id, organizationId: req.org.id } })
  hocuspocus.closeConnections(req.params.proj)
  res.json({ ok: true })
})

const sandboxHint = e => {
  const msg = (e.stderr || e.message || '')
  if (/initializing source|image not known|pinging container registry/.test(msg))
    return 'sandbox image missing: run `just sandbox` on the server'
  if (/podman.*ENOENT/.test(msg) || e.code === 'ENOENT')
    return 'podman not found on server (or set TYDIG_UNSAFE_BUILDS=1 to run on host, trusted setups only)'
  return msg.slice(0, 400) || 'build sandbox unavailable'
}

p.get('/recipes', async (req, res) => {
  try {
    res.json(await listRecipes(req.params.proj))
  } catch (e) { res.json({ error: sandboxHint(e) }) }
})

p.post('/build/:recipe', async (req, res) => {
  if (!okRecipe(req.params.recipe)) return res.status(400).json({ error: 'bad recipe' })
  if (building.has(req.params.proj)) return res.status(409).json({ ok: false, output: 'a build is already running for this project' })
  if (building.size >= MAX_BUILDS) return res.status(429).json({ ok: false, output: 'the hub is running other builds; try again shortly' })
  building.add(req.params.proj)
  try {
    const r = await runner(req.params.proj, [req.params.recipe])
    res.json({ ok: true, output: r.stdout + r.stderr })
  } catch (e) {
    const spawnFail = e.code === 'ENOENT' || /initializing source|image not known/.test(e.stderr || '')
    res.json({ ok: false, output: spawnFail ? sandboxHint(e) : (e.stdout || '') + (e.stderr || e.message) })
  } finally { building.delete(req.params.proj) }
})

// The canonical file state a checkpoint signs: every CRDT-managed text file
// (generated dirs excluded), path -> sha256 of content. Computed from the
// live document when open, from disk otherwise. The client computes the same
// map from its own replica; convergence makes them equal.
async function filesDigest(name) {
  const doc = hocuspocus.documents.get(name)
  const out = {}
  if (doc) {
    for (const [rel, t] of doc.getMap('files'))
      if (okPath(rel) && !GENERATED.test(rel)) out[rel] = sha256hex(t.toString())
  } else {
    for await (const rel of walk(proj(name))) {
      const t = okPath(rel) && !GENERATED.test(rel) ? textOf(await readFile(inProj(name, rel))) : null
      if (t != null) out[rel] = sha256hex(t)
    }
  }
  return out
}

const note = (name, ref, msg) =>
  git(name, 'notes', `--ref=${ref}`, 'add', '-f', '-m', msg, 'HEAD').catch(() => {})

p.post('/checkpoint', async (req, res) => {
  const name = req.params.proj
  const doc = hocuspocus.documents.get(name)
  if (doc) await mirror(name, doc)
  await ensureRepo(name)
  await git(name, 'add', '-A')
  const msg = `checkpoint: ${String(req.body?.message || 'unnamed').slice(0, 200)}`
  try { await git(name, 'commit', '-q', '--allow-empty', '-m', msg) } catch {}

  // Post-quantum provenance: {payload, publicKey, signature} from the client.
  // "verified" requires BOTH a valid ML-DSA signature by a key registered to
  // this account AND that the signed file hashes equal the server's state.
  let provenance = null
  const { payload, publicKey, signature } = req.body || {}
  if (payload && publicKey && signature) {
    const keyId = keyIdOf(publicKey)
    const known = keyStore.lookup(keyId)
    const sigOk = provVerify(publicKey, payload, signature)
    const server = await filesDigest(name)
    const stateOk = canon(payload.files || {}) === canon(server)
    // The public key travels with the note, so a clone can verify it offline.
    provenance = {
      alg: ALG, keyId, publicKey, user: req.user.id,
      verified: !!(known && known.userId === req.user.id && sigOk && stateOk),
      sigOk, stateOk, registered: !!known,
      payload, signature,
    }
    await note(name, 'provenance', JSON.stringify(provenance))
  }

  // Durable comment audit trail: snapshot the live comment map into git
  // notes, so review context survives outside the sync server.
  if (doc) {
    const comments = Object.fromEntries(doc.getMap('comments'))
    if (Object.keys(comments).length)
      await note(name, 'comments', JSON.stringify(comments).slice(0, 200_000))
  }
  res.json({ ok: true, provenance: provenance && {
    keyId: provenance.keyId, verified: provenance.verified,
    sigOk: provenance.sigOk, stateOk: provenance.stateOk } })
})

p.get('/history', async (req, res) => {
  const log = await git(req.params.proj, 'log', '-n', '1000', '--notes=provenance',
    '--pretty=format:%h%x1f%aI%x1f%s%x1f%N%x1e').catch(() => '')
  res.json(log.split('\x1e').map(l => l.trim()).filter(Boolean).map(l => {
    const [hash, date, message, noteRaw] = l.split('\x1f')
    let provenance = null
    try {
      const p = JSON.parse(noteRaw)
      provenance = { alg: p.alg, keyId: p.keyId, verified: p.verified }
    } catch { /* unsigned */ }
    return { hash, date, message, provenance }
  }))
})

p.post('/restore/:hash', async (req, res) => {
  const { proj: name, hash } = req.params
  if (!okHash(hash)) return res.status(400).json({ error: 'bad hash' })
  const doc = hocuspocus.documents.get(name)
  if (!doc) return res.status(409).json({ error: 'project not open in any editor' })
  // git knows which files are text: a binary one shows "-" in numstat
  let listing
  try { listing = (await git(name, 'diff', '--numstat', '--no-renames', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', hash)).split('\n').filter(Boolean) }
  catch { return res.status(404).json({ error: 'no such commit' }) }
  const texts = []
  for (const [added, , rel] of listing.map(l => l.split('\t')))
    if (added !== '-' && okPath(rel) && !GENERATED.test(rel))
      texts.push([rel, await git(name, 'show', `${hash}:${rel}`)])
  doc.transact(() => {
    const files = doc.getMap('files')
    const keep = new Set(texts.map(t => t[0]))
    for (const k of [...files.keys()]) if (!keep.has(k)) files.delete(k)
    for (const [rel, content] of texts) files.has(rel) ? setText(files.get(rel), content) : files.set(rel, new Y.Text(content))
  })
  res.json({ ok: true })
})

p.get('/info', (req, res) => res.json({ root: UNSAFE ? proj(req.params.proj) : '/work', tool: runnerTool(req.params.proj) }))

// ---- federation: link this project to the same-named project on another hub ----
p.get('/federation', async (req, res) => res.json(await federation.status(req.params.proj)))
p.post('/federation/invite', async (req, res) => {
  try { res.json({ invite: await federation.invite(req.params.proj) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
p.post('/federation/link', async (req, res) => {
  try { res.json(await federation.link(req.params.proj, req.body?.invite)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
// ---- git remote: the project's durable home on any git host ----
p.get('/gitremote', async (req, res) => res.json(await gitsync.status(req.params.proj)))
p.post('/gitremote', async (req, res) => {
  try { res.json(await gitsync.setRemote(req.params.proj, req.body?.url, req.body?.branch)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
p.delete('/gitremote', async (req, res) => res.json(await gitsync.clearRemote(req.params.proj)))
p.post('/gitremote/sync', async (req, res) => {
  try { res.json(await gitsync.syncNow(req.params.proj, { reason: 'requested' })) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

p.post('/federation/rotate', async (req, res) => {
  try { res.json(await federation.rotate(req.params.proj)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// Serve the built client when it exists (production/container). In dev, Vite
// serves it on :5173 and proxies here instead.
const STATIC = process.env.TYDIG_STATIC ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist')
if (existsSync(path.join(STATIC, 'index.html'))) {
  // Vite names assets by content hash: cache them forever (the wasm is 20 MB).
  app.use('/assets', express.static(path.join(STATIC, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(STATIC, { index: 'index.html' }))
  // SPA fallback: anything not /api and not a real asset gets index.html
  app.get(/^\/(?!api\/).*/, (req, res, next) =>
    req.method === 'GET' ? res.sendFile(path.join(STATIC, 'index.html')) : next())
  console.log(`serving client from ${STATIC}`)
}

// Express 5 forwards rejected handlers here; say why, never hang the request.
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e)
  const code = [e.statusCode, e.status].find(Number.isInteger) ?? 500
  if (code >= 500) console.error(e)
  res.status(code).json({ error: code < 500 ? e.message : 'internal error' })
})

const PORT = Number(process.env.PORT || 3000)
// The hub's link: tydig's static page plus a seed only this hub holds (link.mjs).
// Pages redirects the github.io address to the custom domain, fragment intact.
import { startLink, newSeed } from './link.mjs'
const PAGE = process.env.TYDIG_LINK === '0' ? '' : process.env.TYDIG_PAGE || 'https://cab-ucf.github.io/tydig/app/'
const seedFile = path.join(DATA, 'link-seed')
if (PAGE && !existsSync(seedFile)) writeFileSync(seedFile, newSeed(randomBytes(16)) + '\n', { mode: 0o600 })
const LINK_SEED = PAGE && readFileSync(seedFile, 'utf8').trim()
const LINK = PAGE && `${PAGE}#${LINK_SEED}${process.env.TYDIG_LINK_RELAY ? `;r=${process.env.TYDIG_LINK_RELAY}` : ''}`
if (LINK) writeFileSync(path.join(DATA, 'link'), LINK + '\n')
const httpServer = app.listen(PORT, e => {
  if (e) throw e
  console.log(`http+sync+lsp on :${PORT} (ws /sync, /lsp)${SYNC_PORT ? `, legacy sync ws :${SYNC_PORT}` : ''}`)
  // Print this every boot: sign-in fails with "Invalid origin" if the address
  // in the browser is not one of these, and that is the commonest setup snag.
  console.log(`open the app at: ${TRUSTED.join('  or  ')}`)
  if (LINK) {
    console.log(`collaborators, from any browser: ${LINK}`)
    startLink({ server: httpServer, seed: LINK_SEED, relay: process.env.TYDIG_LINK_RELAY })
      .catch(e => console.warn('link: failed to start:', e.message))
  }
  federation.start().catch(e => console.warn('federation: failed to start:', e.message))
  gitsync.start()
})
// Saving on the way out is what makes a hub disposable: the git remote holds
// the project, so this machine can disappear.
let leaving = false
// A failed background git call or peer sync must not take the hub down.
process.on('unhandledRejection', e => console.error('unhandled:', e))
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    if (leaving) process.exit(1)
    leaving = true
    console.log('shutting down: saving open documents, pushing to git remotes...')
    for (const [name, doc] of hocuspocus.documents) await store(name, doc).catch(e => console.warn(`save of "${name}" failed (${e.message})`))
    await gitsync.flushAll().catch(() => {})
    await federation.stop().catch(() => {})
    process.exit(0)
  })

// ---------- LSP bridge: ws (JSON messages) <-> tinymist stdio (Content-Length framed) ----------
import { WebSocketServer, WebSocket } from 'ws'
import { spawn } from 'node:child_process'
const lspWss = new WebSocketServer({ noServer: true })
const MAX_LSP = Number(process.env.TYDIG_MAX_LSP || 8)
let lsps = 0
const syncWss = new WebSocketServer({ noServer: true })
httpServer.on('upgrade', async (req, sock, head) => {
  sock.on('error', () => {}) // a client reset while we await the session must not crash the hub
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/sync' || u.pathname.startsWith('/sync/')) {
    return syncWss.handleUpgrade(req, sock, head, ws => hocuspocus.handleConnection(ws, req))
  }
  if (u.pathname !== '/lsp') return sock.destroy()
  const name = u.searchParams.get('proj')
  if (!okName(name) || !existsSync(proj(name))) return sock.destroy()
  // Session via cookie (same-origin) or ?t= token (cross-port dev/ws).
  const headers = new Headers()
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie)
  else if (u.searchParams.get('t')) headers.set('cookie', `better-auth.session_token=${u.searchParams.get('t')}`)
  const sess = await sessionFrom(headers)
  if (!originOk(req.headers.origin) || !sess?.user || !await authorizeProject(headers, name) || lsps >= MAX_LSP) return sock.destroy()
  lspWss.handleUpgrade(req, sock, head, ws => {
    // tinymist runs in the build sandbox, like any other project code: its
    // commands write files, so on the host it would be a way out of the project.
    const lsp = UNSAFE ? spawn('tinymist', ['lsp'], { cwd: proj(name), stdio: ['pipe', 'pipe', 'ignore'] })
      : spawn('podman', [...sandboxArgs(proj(name), 86400, '-i'), 'tinymist', 'lsp'], { stdio: ['pipe', 'pipe', 'ignore'] })
    lsps++
    lsp.on('close', () => lsps--)
    lsp.on('error', () => ws.close(1011, 'tinymist unavailable'))
    lsp.stdin.on('error', () => ws.close()) // the process died: EPIPE, not a crash
    ws.on('message', m => {
      if (!lsp.stdin.writable) return
      const body = Buffer.from(m)
      lsp.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      lsp.stdin.write(body)
    })
    let buf = Buffer.alloc(0)
    lsp.stdout.on('data', d => {
      buf = Buffer.concat([buf, d])
      for (;;) {
        const sep = buf.indexOf('\r\n\r\n')
        if (sep < 0) return
        const len = Number(/content-length: *(\d+)/i.exec(buf.subarray(0, sep))?.[1] ?? 0)
        if (buf.length < sep + 4 + len) return
        ws.send(buf.subarray(sep + 4, sep + 4 + len).toString())
        buf = buf.subarray(sep + 4 + len)
      }
    })
    const bye = () => { try { lsp.kill() } catch {} }
    ws.on('close', bye); lsp.on('exit', () => ws.close())
  })
})
