import './private.mjs' // first: everything the hub writes is its own
// tydig server v2
// Project = git repo at data/<proj>/. Text files live in a Yjs map ('files':
// path -> Y.Text) mirrored to disk on autosave; binaries (images, built PDFs)
// live disk-only. Builds run `make <target>` (or `just <recipe>`) in the project dir.
import { Server } from '@hocuspocus/server'
import express from 'express'
import * as Y from 'yjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, open, writeFile, readFile, readdir, rm, stat, lstat, realpath, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, constants as FS } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import path from 'node:path'
import net from 'node:net'
import { at } from './sandbox.mjs'

const run = promisify(execFile)
// Project store. TYDIG_DATA must be an absolute path when the server runs
// in a container and builds go to the sandbox service: the host mounts
// the project dir by the path the server names, so both sides must agree.
const DATA = path.resolve(process.env.TYDIG_DATA || 'data')

// ---------- auth: better-auth sessions + organization-based project access ----------
await mkdir(DATA, { recursive: true })
import { auth, authorizeProject, userProjects, lifecycle } from './auth.mjs'

// Validate a session from request headers (cookie). Returns {user,session}|null.
const sessionFrom = async headers => auth.api.getSession({ headers }).catch(() => null)
console.log('auth ready (email/password + project sharing via organizations)')


// ---------- sandboxed builds ----------
const UNSAFE = process.env.TYDIG_UNSAFE_BUILDS === '1'
// Builds and the LSP run in the build sandbox, started by sandbox.mjs: the
// hub never holds the podman socket, only a line to ask for a sandbox.
// just is never run on the host unless UNSAFE: even `just --summary`
// evaluates backtick assignments in the justfile (code execution).
const SANDBOX = at(process.env.TYDIG_SANDBOX || 'sandbox:7000')
const sandbox = (proj, cmd, secs, i) => {
  const s = net.connect(...SANDBOX)
  s.write(JSON.stringify({ proj, cmd, secs, i }) + '\n')
  return s
}
const inSandbox = (name, cmd, secs) => new Promise((ok, no) => {
  let out = ''
  sandbox(name, cmd, secs).on('data', d => out += d).on('error', no).on('end', () => {
    const r = /^\{/.test(out) ? JSON.parse(out) : { code: -1, stdout: '', stderr: 'the build sandbox did not answer' }
    r.code === 0 ? ok(r) : no(Object.assign(new Error(r.stderr), r))
  })
})
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
  return (UNSAFE
    ? run(tool, args, { cwd: proj(name), env: { ...process.env, TYPST_ROOT: proj(name) }, timeout, maxBuffer: 8e6 })
    : inSandbox(name, [tool, ...argv], timeout / 1000)
  ).finally(() => scrub(name))
}
// What a build may leave that the hub would trust: nested git repos (their
// config runs commands) and symlinks (paths out of the project). Gone after each.
const scrub = name => run('find', [proj(name), '-mindepth', '1', '(', '-path', `${proj(name)}/.git`, '-prune', ')',
  '-o', '(', '-name', '.git', '-prune', '-exec', 'rm', '-rf', '{}', '+', ')', '-o', '-type', 'l', '-exec', 'rm', '-f', '{}', '+']).catch(() => {})
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
const HUB_DIRS = /^(gitsync|federation|agents)$/i // DATA/ beside the projects; never one
// a project: a git repo under DATA that is not one of the hub's own directories
const isProj = n => okName(n) && !HUB_DIRS.test(n) && existsSync(path.join(DATA, n, '.git'))
const okHash = h => /^[0-9a-f]{7,40}$/.test(h)
const okPath = p => typeof p === 'string' && p.length < 256 && /^[\w./@ -]+$/.test(p) &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
const okRecipe = r => /^[\w-]{1,64}$/.test(r)
const proj = n => path.join(DATA, n)
const inProj = (n, p) => path.join(proj(n), p)
const gitQ = new Map()
// Never wait on a person (a credential prompt) or forever (a stalled remote):
// the queue below is per project, so one stuck call would stop its autosaves.
// core.fsmonitor off, for this repo and any nested one: a build can leave a
// sub/.git whose fsmonitor command the hub's own `git add` would run, on the
// host, outside the sandbox.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' }
// Private remotes: each project gets its own SSH key (a deploy key: one repo,
// nothing else), kept beside the projects, never in one, so no build can
// read it. GitHub's host key is pinned; other hosts are trusted on first use.
const KEYS = path.join(DATA, 'gitsync', 'keys'), KNOWN = path.join(DATA, 'gitsync', 'known_hosts')
mkdirSync(KEYS, { recursive: true, mode: 0o700 })
if (!existsSync(KNOWN)) writeFileSync(KNOWN,
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n')
const keyOf = n => path.join(KEYS, n)
// the project's deploy key and nothing else: no ~/.ssh keys, config or agent
const ssh = n => `ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile='${KNOWN}'` +
  ` -o IdentitiesOnly=yes -o IdentityAgent=none -i '${keyOf(n)}'`
const deployKey = async n => {
  if (!existsSync(keyOf(n))) await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `tydig:${n}`, '-f', keyOf(n)])
  return (await readFile(keyOf(n) + '.pub', 'utf8')).trim()
}
const sshUrl = u => /^(git@|ssh:\/\/)/.test(String(u))
const git = (n, ...a) => {
  const r = (gitQ.get(n) || Promise.resolve()).then(() => run('git', ['-C', proj(n), ...a],
    { maxBuffer: 1 << 28, timeout: 600_000, env: { ...GIT_ENV, GIT_SSH_COMMAND: ssh(n) } }))
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
// Opened, then checked: the kernel says where the open file really is, so a
// build swapping a directory for a symlink between safe() and the open
// cannot lead the hub out of the project (Linux; elsewhere safe() alone).
// Written files are truncated only once that check has passed.
const openIn = async (n, rel, write) => {
  const fh = await open(await safe(n, rel), (write ? FS.O_WRONLY | FS.O_CREAT : FS.O_RDONLY) | (FS.O_NOFOLLOW || 0), 0o644)
  const at = await realpath(`/proc/self/fd/${fh.fd}`).catch(() => null)
  if (at && !at.startsWith(await realpath(proj(n)) + path.sep)) {
    await fh.close(); throw Object.assign(new Error('bad path'), { status: 400 })
  }
  return fh
}
const readIn = async (n, rel) => { const fh = await openIn(n, rel); try { return await fh.readFile() } finally { await fh.close() } }
const writeIn = async (n, rel, data) => {
  const fh = await openIn(n, rel, true)
  try { await fh.truncate(0); await fh.writeFile(data) } finally { await fh.close() }
}
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
const mirrored = new Map() // proj -> Map path -> the text we last wrote: the base an outside edit is merged from

// An edit from outside (an agent, a shell, a git pull) merged into the live
// text, three ways, by git merge-file: what changed from base to theirs
// lands in ours, and where both sides changed the same lines the live
// text (what people are typing) wins.
async function merge3(base, ours, theirs) {
  if (theirs === base || theirs === ours) return ours
  if (ours === base) return theirs
  return (await mergeFile(base, ours, theirs, '--ours')).text
}
// git merge-file: the merged text, and how many places both sides changed
async function mergeFile(base, ours, theirs, ...flags) {
  const d = await mkdtemp(path.join(tmpdir(), 'tydig-'))
  try {
    const f = ['ours', 'base', 'theirs'].map(n => path.join(d, n))
    await Promise.all([ours, base, theirs].map((t, i) => writeFile(f[i], t)))
    const r = await run('git', ['merge-file', '-p', ...flags, ...f]).catch(e => e)
    return { text: r.stdout, conflicts: typeof r.code === 'number' ? r.code : 0 }
  } finally { rm(d, { recursive: true, force: true }) }
}

async function mirror(name, document) {
  await ensureRepo(name)
  const cur = new Set(), last = mirrored.get(name) ?? mirrored.set(name, new Map()).get(name)
  for (const [rel, t] of document.getMap('files')) {
    if (!okPath(rel) || GENERATED.test(rel)) continue
    cur.add(rel)
    // unchanged text is not rewritten: an outside edit waiting to be merged stays
    const text = t.toString()
    if (last.get(rel) === text && existsSync(inProj(name, rel))) continue
    await mkdir(path.dirname(inProj(name, rel)), { recursive: true })
    await writeIn(name, rel, text).then(() => last.set(rel, text))
      .catch(e => console.warn(`mirror: skipped ${rel} (${e.message})`))
  }
  for (const old of written.get(name) ?? [])
    if (!cur.has(old) && okPath(old) && !GENERATED.test(old))
      building.has(name) ? cur.add(old) // deleted after the build: see idle
        : await safe(name, old).then(f => rm(f, { force: true })).catch(() => {})
  written.set(name, cur)
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
    // events from our own writes too: they match what we wrote, so merge to nothing
    if (!fname || fname.startsWith('.git')) return
    seen.add(fname.replaceAll('\\', '/'))
    clearTimeout(t)
    t = setTimeout(async () => {
      // A new text file (copied in, pulled, written by a script) becomes
      // editable at once; one deleted (rm, rm -r of its folder) leaves the
      // CRDT; one edited on disk (an agent, a shell) is merged into the live
      // text from what the hub last wrote, so typing since is kept.
      const files = document.getMap('files'), add = [], gone = [], edit = []
      for (const rel of seen) {
        if (!existsSync(inProj(name, rel))) {
          gone.push(...[...files.keys()].filter(k => k === rel || k.startsWith(rel + '/')))
          continue
        }
        if (!okPath(rel) || GENERATED.test(rel)) continue
        const b = await readIn(name, rel).catch(() => null)
        const text = b && textOf(b), base = mirrored.get(name)?.get(rel)
        if (text == null) continue
        if (!files.has(rel)) add.push([rel, text])
        else if (base != null && text !== base) edit.push([rel, await merge3(base, files.get(rel).toString(), text)])
      }
      // previews refresh for anything but the hub writing back what is typed
      const fresh = add.length || edit.length || gone.length || [...seen].some(rel => !files.has(rel))
      seen.clear()
      document.transact(() => {
        for (const [rel, text] of add) files.has(rel) || files.set(rel, new Y.Text(text))
        for (const [rel, text] of edit) files.has(rel) && setText(files.get(rel), text)
        for (const rel of gone) files.delete(rel)
      })
      if (fresh) document.getMap('meta').set('diskRev', Date.now())
    }, 400)
  })
  watchers.set(name, w)
}

const hocuspocus = Server.configure({
  port: 1234,
  debounce: 2000,
  async onAuthenticate({ token, requestHeaders, documentName }) {
    if (!isProj(documentName)) throw new Error('no such project')
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
    if (!isProj(name)) return document
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
    mirrored.set(name, new Map()) // nothing known written yet: the first save writes all
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
  if (!isProj(name)) return
  await ensureRepo(name)
  const tmp = `${crdtFile(name)}.${randomBytes(4).toString('hex')}`
  await writeFile(tmp, Y.encodeStateAsUpdate(document))
  await rename(tmp, crdtFile(name))
  await mirror(name, document)
  await git(name, 'add', '-A')
  await git(name, 'commit', '-q', '-m', 'autosave').catch(() => {})
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
// Commits on the remote that no hub wrote (an agent's push, an edit on
// GitHub) reach the CRDT here: each text file they changed, merged three
// ways from the merge base. A hub's own commits merge as no-ops, since its
// CRDT state, absorbed first, already holds them.
async function outside(p, ydoc, head) {
  const mb = (await git(p, 'merge-base', head, 'FETCH_HEAD')).trim()
  const show = (c, f) => git(p, 'show', `${c}:${f}`).catch(() => null)
  const files = ydoc.getMap('files'), out = []
  for (const rel of (await git(p, 'diff', '--name-only', '-z', mb, 'FETCH_HEAD')).split('\0')) {
    if (!rel || !okPath(rel) || GENERATED.test(rel) || rel.startsWith('.collab/')) continue
    const [base, theirs] = await Promise.all([show(mb, rel), show('FETCH_HEAD', rel)])
    if (theirs?.includes('\0')) continue // binary
    const t = files.get(rel)
    out.push([rel, theirs == null ? null : t ? await merge3(base ?? '', t.toString(), theirs) : theirs])
  }
  ydoc.transact(() => {
    for (const [rel, text] of out)
      text == null ? files.delete(rel) : files.has(rel) ? setText(files.get(rel), text) : files.set(rel, new Y.Text(text))
  })
}
const gitsync = createGitSync({
  hocuspocus, dataDir: DATA, proj, git, mirror, okName, outside,
  hubId: () => localHubId,
})

// The sync server also shares the main HTTP port at /sync (see below), which
// is what lets a single container serve the whole app with no reverse proxy.
// The dedicated :1234 listener stays on for the dev proxy and existing tests;
// set TYDIG_SYNC_PORT=0 to run single-port only.
const SYNC_PORT = process.env.TYDIG_SYNC_PORT === '0' ? null : 1234
if (SYNC_PORT) hocuspocus.listen()

// ---------- project templates ----------
// server/templates/<name>/. A name is built in layers: nih-r21 is nih/ and
// then nih-r21/ on top, so what NIH mechanisms share is written once. Only
// names that are no other's layer are offered. A brand-<name>/ (logos,
// colours, letterhead) goes on last, over whichever template is chosen.
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates')
const LAYERS = readdirSync(TEMPLATES).sort()
const BRANDS = LAYERS.filter(l => l.startsWith('brand-')).map(l => l.slice(6))
const TEMPLATE_NAMES = ['report', ...LAYERS.filter(t => t !== 'report' && !t.startsWith('brand-') &&
  !LAYERS.some(u => u.startsWith(t + '-')))]
const layersOf = (t, brand) => [...LAYERS.filter(l => t === l || t.startsWith(l + '-')), ...BRANDS.includes(brand) ? ['brand-' + brand] : []]
const scaffold = async (t, brand, dir) => {
  for (const l of layersOf(t, brand)) await cp(path.join(TEMPLATES, l), dir, { recursive: true })
  await mkdir(path.join(dir, '.collab'), { recursive: true })
  await writeFile(path.join(dir, '.collab', 'template.json'), JSON.stringify({ template: t, brand: brand || null }))
}
// every file a template (with a brand) gives a project: path -> bytes, later layers winning
async function stack(t, brand) {
  const files = new Map()
  for (const l of layersOf(t, brand)) for await (const rel of walk(path.join(TEMPLATES, l))) files.set(rel, await readFile(path.join(TEMPLATES, l, rel)))
  return files
}

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
// localhost: a model on the person's own machine (ghost suggestions, Ollama);
// Crossref and PubMed: finding papers and checking references (cite.js)
const CSP = `default-src 'self'; connect-src 'self' ${TRUSTED.map(o => o.replace(/^http/, 'ws')).join(' ')} http://localhost:* http://127.0.0.1:* https://api.crossref.org https://eutils.ncbi.nlm.nih.gov; ` +
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
  if (/^\/api\/auth\/organization\/(create|update|delete)\b/.test(new URL(req.originalUrl, 'http://h').pathname))
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
  // a link visitor has no IP: its iroh id, as a private IPv6 address whose
  // first 64 bits differ per visitor (rate limits group IPv6 by /64)
  req.headers['x-tydig-ip'] = req.socket.link
    ? (h => `fd${h.slice(0, 2)}:${h.slice(2, 14).match(/.{4}/g).join(':')}::1`)(createHash('sha256').update(String(req.socket.peer)).digest('hex'))
    : req.ip
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
  linkOnline,
}))

// Everything else under /api requires a valid session.
// ---------- agents: members that are programs ----------
// An owner adds one in Share and gets a token, once; the hub keeps only its
// hash (DATA/agents/<proj>.json). With it an agent (agent.mjs, through
// agent-mcp.mjs) reads and edits this project's text, sees where it is
// @mentioned, and answers in the Discussion. Nothing else: no sharing,
// remotes, builds or other projects.
const agentsFile = n => path.join(DATA, 'agents', `${n}.json`)
const agentsOf = n => { try { return JSON.parse(readFileSync(agentsFile(n), 'utf8')) } catch { return [] } }
const saveAgents = (n, a) => { mkdirSync(path.dirname(agentsFile(n)), { recursive: true }); writeFileSync(agentsFile(n), JSON.stringify(a, null, 1)) }
const tokenHash = t => createHash('sha256').update(String(t)).digest('hex')
const live = async (n, f) => { const dc = await hocuspocus.openDirectConnection(n, { agent: true }); try { return await f(dc.document) } finally { await dc.disconnect().catch(() => {}) } }
const quoteOf = (doc, c) => {
  const t = doc.getMap('files').get(c.file), at = s => t && Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(s, 'base64')), doc)?.index
  const a = at(c.anchor), b = at(c.head)
  return a != null && b != null ? t.toString().slice(a, b) : null
}
const ag = express.Router({ mergeParams: true })
app.use('/api/agent/:proj', (req, res, next) => {
  const t = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1], n = req.params.proj
  const a = t && isProj(n) && agentsOf(n).find(a => a.hash === tokenHash(t))
  if (!a) return res.status(401).json({ error: 'not a valid agent token for this project' })
  req.agent = a.name; next()
}, ag)
// Where it is @mentioned and has not yet answered (its replies name what they answer).
ag.get('/tasks', async (req, res) => res.json(await live(req.params.proj, doc => {
  const at = new RegExp(`@${req.agent}\\b`, 'i'), chat = doc.getArray('chat').toArray(), comments = doc.getMap('comments')
  const done = new Set(chat.filter(m => m.agent === req.agent).map(m => m.answers))
  const ctx = c => c && { file: c.file, quote: quoteOf(doc, c), comment: c.text }
  return { agent: req.agent, tasks: [
    ...[...comments].filter(([id, c]) => at.test(c.text) && !done.has(id)).map(([id, c]) => ({ id, from: c.author, text: c.text, ts: c.ts, ...ctx(c) })),
    ...chat.filter(m => !m.agent && at.test(m.text) && !done.has(m.id)).map(m => ({ id: m.id, from: m.author, text: m.text, ts: m.ts, ...ctx(m.re && comments.get(m.re)) })),
  ] }
})))
ag.get('/files', async (req, res) => res.json(await live(req.params.proj, doc => [...doc.getMap('files').keys()].sort())))
ag.get('/file', async (req, res) => {
  const text = await live(req.params.proj, doc => doc.getMap('files').get(String(req.query.path))?.toString())
  text == null ? res.status(404).json({ error: 'no such text file' }) : res.json({ path: req.query.path, text })
})
// Written into the live text, merged from what the agent read (base), so
// typing done since is kept.
ag.put('/file', async (req, res) => {
  const { path: rel, text, base } = req.body || {}
  if (!okPath(rel) || GENERATED.test(rel) || typeof text !== 'string' || text.length > 1e6) return res.status(400).json({ error: 'bad path or text' })
  await live(req.params.proj, async doc => {
    const files = doc.getMap('files'), t = files.get(rel)
    const merged = t && typeof base === 'string' ? await merge3(base, t.toString(), text) : text
    doc.transact(() => t ? setText(t, merged) : files.set(rel, new Y.Text(merged)))
  })
  res.json({ ok: true })
})
ag.post('/say', async (req, res) => {
  const { text, answers } = req.body || {}
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) return res.status(400).json({ error: 'say something' })
  await live(req.params.proj, doc => {
    const chat = doc.getArray('chat'), asked = chat.toArray().find(m => m.id === answers)
    const re = doc.getMap('comments').has(answers) ? answers : asked?.re
    chat.push([{ id: randomBytes(8).toString('hex'), author: req.agent, agent: req.agent, color: 'hsl(280 70% 55%)',
      text: text.trim(), ts: Date.now(), ...(answers && { answers }), ...(re && { re }) }])
  })
  res.json({ ok: true })
})

app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  const sess = await sessionFrom(fromNodeHeaders(req.headers))
  if (!sess?.user) return res.status(401).json({ error: 'not signed in' })
  req.user = sess.user
  req.authHeaders = fromNodeHeaders(req.headers)
  next()
})

app.get('/api/me', (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }))
app.get('/api/link', (req, res) => res.json({ link: LINK, online: linkOnline }))

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
app.post('/api/bridge/:id', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
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
app.get('/api/templates', (req, res) => res.json({ templates: TEMPLATE_NAMES, brands: BRANDS }))
app.get('/api/projects', async (req, res) => {
  const orgs = await userProjects(req.authHeaders)
  const names = (await readdir(DATA, { withFileTypes: true }).catch(() => []))
    .filter(e => e.isDirectory()).map(e => e.name)
  res.json(names.filter(n => orgs.has(n)).map(n => ({ name: n, role: orgs.get(n).role || 'member' })))
})

app.post('/api/projects/:name', async (req, res) => {
  const n = req.params.name
  // gitsync/ and federation/ beside the projects hold the hub's own settings
  if (!okName(n) || HUB_DIRS.test(n)) return res.status(400).json({ error: 'bad project name' })
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
    // A private repo over SSH: the key is made first, and kept if the clone
    // fails, so the person can add it to the repo and simply try again.
    const key = sshUrl(gitUrl) ? await deployKey(n) : null
    try { await gitsync.adopt(n, gitUrl, req.body?.branch) }
    catch (e) { // leave nothing behind, so a corrected URL can be tried under the same name
      await rm(proj(n), { recursive: true, force: true })
      await auth.api.deleteOrganization({ headers: req.authHeaders, body: { organizationId: org.id } }).catch(() => {})
      return res.status(400).json({ error: `could not adopt ${gitUrl}: ${e.message}`, key })
    }
    return res.json({ ok: true, adopted: true })
  }
  if (!invite) {
    await scaffold(TEMPLATE_NAMES.includes(req.body?.template) ? req.body.template : 'report', req.body?.brand, proj(n))
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
  // only a project: never the hub's own directories, whatever org claims the name
  if (!isProj(req.params.proj))
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
  const fh = await openIn(req.params.proj, rel)
  res.type(path.extname(rel) || 'bin').set('Content-Length', (await fh.stat()).size)
  fh.createReadStream().pipe(res)
})

// any body: browsers send no Content-Type for extensions they don't know (.dat, .npy, .h5)
// Disk per project (TYDIG_QUOTA_MB, 1000): uploads that would pass it are refused.
const QUOTA = Number(process.env.TYDIG_QUOTA_MB || 1000) * 2 ** 20
const used = async n => { let b = 0; for await (const rel of walk(proj(n))) b += (await lstat(inProj(n, rel)).catch(() => ({ size: 0 }))).size; return b }
// While a build runs it can swap a directory for a symlink, so writes and deletes wait.
const idle = (req, res, next) => building.has(req.params.proj)
  ? res.status(409).json({ error: 'a build is running in this project; try again when it ends' }) : next()
p.put('/raw/*rel', idle, express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  const rel = wild(req)
  if (await used(req.params.proj) + (req.body?.length || 0) > QUOTA)
    return res.status(413).json({ error: `this project is at its ${QUOTA / 2 ** 20} MB limit (TYDIG_QUOTA_MB)` })
  await mkdir(path.dirname(inProj(req.params.proj, rel)), { recursive: true })
  await writeIn(req.params.proj, rel, req.body ?? '')
  res.json({ ok: true })
})

p.delete('/raw/*rel', idle, async (req, res) => {
  await rm(await safe(req.params.proj, wild(req)))
  res.json({ ok: true })
})

// The project as a .tar.gz: its sources (what git keeps, enough to rebuild
// the rest) or, with ?all=1, everything on disk, builds and PDFs included.
// Never .git or .collab. tar stores symlinks as links, never follows them.
p.get('/archive', async (req, res) => {
  const n = req.params.proj, all = req.query.all === '1'
  const files = all ? ['.'] : (await git(n, 'ls-files', '-z', '-co', '--exclude-standard'))
    .split('\0').filter(f => f && !/^\.collab\//.test(f))
  const tar = spawn('tar', ['-czf', '-', '--exclude=./.git', '--exclude=./.collab', '--null', '-T', '-'],
    { cwd: proj(n), stdio: ['pipe', 'pipe', 'ignore'] })
  tar.stdin.end(files.join('\0'))
  res.attachment(`${n}${all ? '' : '-src'}.tar.gz`).type('application/gzip')
  tar.stdout.pipe(res)
  res.on('close', () => tar.kill())
})

// Sharing: an owner or admin adds an account, or invites an address that has
// none yet. Nothing sends mail: the invitation is what lets that address sign
// up, and the project is waiting when it does.
p.post('/members', async (req, res) => {
  if (!['owner', 'admin'].includes(req.org.role)) return res.status(403).json({ error: 'only the owner can share this project' })
  const email = String(req.body?.email || '').trim()
  const u = authDb.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(email)
  if (u) await auth.api.addMember({ body: { userId: u.id, organizationId: req.org.id, role: 'member' } })
  // No account yet: an invitation, whose id is the one-time key the invite
  // link carries; signing up as this address needs it (auth.mjs).
  const inv = !u && await auth.api.createInvitation({ headers: req.authHeaders, body: { email, role: 'member', organizationId: req.org.id } })
  res.json({ ok: true, invited: !u, invite: inv?.id ?? null })
})
// Removal through the hub, not better-auth directly, so it takes effect now:
// every editor reconnects and re-authenticates, and the removed one cannot.
p.delete('/members/:id', async (req, res) => {
  await auth.api.removeMember({ headers: req.authHeaders, body: { memberIdOrEmail: req.params.id, organizationId: req.org.id } })
  // everyone reconnects and is checked again; the removed member is refused
  hocuspocus.closeConnections(req.params.proj)
  lspOpen.get(req.params.proj)?.forEach(ws => ws.close())
  res.json({ ok: true })
})

const sandboxHint = e => {
  const msg = (e.stderr || e.message || '')
  if (/initializing source|image not known|pinging container registry/.test(msg))
    return 'sandbox image missing: run `just sandbox` on the server'
  if (typeof e.code === 'string')
    return 'the build sandbox is not running: `just up` starts it (or TYDIG_UNSAFE_BUILDS=1 runs builds on this machine, trusted setups only)'
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
    const spawnFail = typeof e.code === 'string' || /initializing source|image not known/.test(e.stderr || '')
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
  // Saving is committing and, with a remote, pushing.
  // A slow remote does not hold the save: after 20 s the push carries on alone.
  const pushed = (await gitsync.status(name)).configured ? await Promise.race([
    gitsync.syncNow(name, { reason: 'save' }).catch(e => ({ ok: false, error: e.message })),
    new Promise(r => setTimeout(r, 20_000, { ok: null }))]) : null
  res.json({ ok: true, pushed: pushed && { ok: pushed.ok, error: pushed.error || null }, provenance: provenance && {
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
// Where a project goes (a git remote, a peer hub) is the owner's call: a
// member who could set it would keep a copy flowing after being removed.
const admin = (req, res, next) => ['owner', 'admin'].includes(req.org.role) ? next()
  : res.status(403).json({ error: 'only the project owner or an admin can change where it syncs' })
p.get('/federation', async (req, res) => res.json(await federation.status(req.params.proj)))
// ---- a project's template, and switching it (R21 to R03, a report to a grant) ----
// Each template file is merged three ways: from the old template's version
// (base) to the new one's, into the project's own (yours). What the new
// template changes lands; what you changed stays, and where both changed the
// same lines, yours wins (and is reported). A file the new template rewrites
// (most of its lines new), or one that was never the template's, stays
// yours, with the new template's beside it (main.nih-r21.typ): mixing two
// different documents line by line would make a third that is neither.
// Old template files you never touched go (git history keeps them). Moving
// prose into a new structure is writing: ask an @agent member for that.
// how much of the old version a new one keeps: the share of its lines still there
const kept = (a, b) => { const have = new Set(b.split('\n')), l = a.split('\n'); return l.filter(x => have.has(x)).length / l.length }
const recorded = async n => JSON.parse(await readFile(path.join(proj(n), '.collab', 'template.json'), 'utf8').catch(() => 'null'))
const fileNow = async (n, doc, rel) => { const t = doc.getMap('files').get(rel); return t ? Buffer.from(t.toString()) : readIn(n, rel).catch(() => null) }
// a project from before templates were recorded: the one its files match best
async function inferTemplate(n, doc) {
  let best = null, most = 0
  for (const template of TEMPLATE_NAMES) for (const brand of [null, ...BRANDS]) {
    let k = 0
    for (const [rel, b] of await stack(template, brand)) if ((await fileNow(n, doc, rel))?.equals(b)) k++
    if (k > most) { most = k; best = { template, brand } }
  }
  return best
}
p.get('/template', async (req, res) => {
  const n = req.params.proj, r = await recorded(n)
  res.json({ ...(r || await live(n, doc => inferTemplate(n, doc)) || {}), recorded: !!r, templates: TEMPLATE_NAMES, brands: BRANDS })
})
p.post('/template', admin, async (req, res) => {
  const n = req.params.proj, { template, brand = null } = req.body || {}
  if (!TEMPLATE_NAMES.includes(template) || (brand && !BRANDS.includes(brand))) return res.status(400).json({ error: 'no such template or brand' })
  const report = { added: [], updated: [], merged: [], kept: [], beside: [], removed: [] }
  let from
  await live(n, async doc => {
    from = await recorded(n) || await inferTemplate(n, doc)
    const old = from ? await stack(from.template, from.brand) : new Map(), next = await stack(template, brand), files = doc.getMap('files')
    const put = async (rel, b) => { const t = textOf(b)
      if (t != null && !GENERATED.test(rel)) files.has(rel) ? setText(files.get(rel), t) : files.set(rel, new Y.Text(t))
      else { await mkdir(path.dirname(inProj(n, rel)), { recursive: true }); await writeIn(n, rel, b) } }
    for (const [rel, theirs] of next) {
      const base = old.get(rel), cur = await fileNow(n, doc, rel)
      if (!cur) { await put(rel, theirs); report.added.push(rel); continue }
      if (cur.equals(theirs)) continue
      if (base?.equals(cur)) { await put(rel, theirs); report.updated.push(rel); continue }
      const [b, y, t] = [base, cur, theirs].map(x => x && textOf(x))
      if (b != null && y != null && t != null && files.has(rel) && kept(b, t) >= 0.5) {
        const { conflicts } = await mergeFile(b, y, t)
        setText(files.get(rel), await merge3(b, y, t)); report.merged.push(rel)
        if (conflicts) report.kept.push([rel, conflicts])
        continue
      }
      const side = rel.replace(/(\.[^./]+)?$/, `.${template}$1`)
      await put(side, theirs); report.beside.push([rel, side])
    }
    for (const [rel, b] of old) if (!next.has(rel) && (await fileNow(n, doc, rel))?.equals(b)) {
      files.has(rel) ? files.delete(rel) : await rm(inProj(n, rel), { force: true }); report.removed.push(rel)
    }
    await mirror(n, doc)
  })
  await writeFile(path.join(proj(n), '.collab', 'template.json'), JSON.stringify({ template, brand }))
  await git(n, 'add', '-A')
  await git(n, 'commit', '-q', '-m', `checkpoint: template ${from ? `${from.template}${from.brand ? '+' + from.brand : ''}` : 'none'} -> ${template}${brand ? '+' + brand : ''}`).catch(() => {})
  res.json({ from, ...report })
})

p.get('/agents', (req, res) => res.json(agentsOf(req.params.proj).map(({ name, created }) => ({ name, created }))))
p.post('/agents', admin, (req, res) => {
  const name = String(req.body?.name || '').trim().toLowerCase(), list = agentsOf(req.params.proj)
  if (!/^[a-z][\w-]{0,31}$/.test(name) || list.some(a => a.name === name)) return res.status(400).json({ error: 'a new name: letters, digits, - or _' })
  const token = `tyd_${randomBytes(24).toString('base64url')}`
  saveAgents(req.params.proj, [...list, { name, hash: tokenHash(token), created: new Date().toISOString() }])
  res.json({ name, token }) // shown once; the hub keeps only its hash
})
p.delete('/agents/:name', admin, (req, res) => { saveAgents(req.params.proj, agentsOf(req.params.proj).filter(a => a.name !== req.params.name)); res.json({ ok: true }) })
p.post('/federation/invite', admin, async (req, res) => {
  try { res.json({ invite: await federation.invite(req.params.proj) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
p.post('/federation/link', admin, async (req, res) => {
  try { res.json(await federation.link(req.params.proj, req.body?.invite)) }
  catch (e) { res.status(400).json({ error: e.message }) }
})
// ---- git remote: the project's durable home on any git host ----
const withKey = async (n, st) => ({ ...st, key: existsSync(keyOf(n)) ? await deployKey(n) : null })
p.get('/gitremote', async (req, res) => res.json(await withKey(req.params.proj, await gitsync.status(req.params.proj))))
p.post('/gitremote', admin, async (req, res) => {
  try {
    const st = await gitsync.setRemote(req.params.proj, req.body?.url, req.body?.branch)
    if (sshUrl(req.body?.url)) await deployKey(req.params.proj)
    res.json(await withKey(req.params.proj, st))
  }
  catch (e) { res.status(400).json({ error: e.message }) }
})
p.delete('/gitremote', admin, async (req, res) => res.json(await gitsync.clearRemote(req.params.proj)))
p.post('/gitremote/sync', async (req, res) => {
  try { res.json(await gitsync.syncNow(req.params.proj, { reason: 'requested' })) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

p.post('/federation/rotate', admin, async (req, res) => {
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
import { startLink, newSeed } from './link.mjs'
import { RELAY as DEFAULT_RELAY, relayUrl } from './relay.mjs'
const PAGE = process.env.TYDIG_LINK === '0' ? '' : process.env.TYDIG_PAGE || 'https://cxn.pub/app/'
const seedFile = path.join(DATA, 'link-seed')
if (PAGE && !existsSync(seedFile)) writeFileSync(seedFile, newSeed(randomBytes(16)) + '\n', { mode: 0o600 })
const LINK_SEED = PAGE && readFileSync(seedFile, 'utf8').trim()
let linkOnline = false
const RELAY = process.env.TYDIG_LINK_RELAY || DEFAULT_RELAY // see relay.mjs
const LINK = PAGE && `${PAGE}#${LINK_SEED}${RELAY !== DEFAULT_RELAY ? `;r=${RELAY}` : ''}`
if (LINK) writeFileSync(path.join(DATA, 'link'), LINK + '\n', { mode: 0o600 })
const httpServer = app.listen(PORT, e => {
  if (e) throw e
  console.log(`http+sync+lsp on :${PORT} (ws /sync, /lsp)${SYNC_PORT ? `, legacy sync ws :${SYNC_PORT}` : ''}`)
  // Print this every boot: sign-in fails with "Invalid origin" if the address
  // in the browser is not one of these, and that is the commonest setup snag.
  console.log(`open the app at: ${TRUSTED.join('  or  ')}`)
  if (LINK) {
    console.log(`collaborators, from any browser: ${LINK}`)
    // Say whether the link works: it needs the hub to reach its relay over HTTPS.
    startLink({ server: httpServer, seed: LINK_SEED, relay: relayUrl(RELAY) })
      .then(l => {
        const late = setTimeout(() => console.warn('link: no relay reachable yet, so the link will not connect. ' +
          'The hub needs outbound HTTPS (port 443) to *.relay.n0.iroh.link.'), 20_000)
        return l.online().then(() => { clearTimeout(late); linkOnline = true; console.log('link: online; collaborators can connect') })
      })
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
const MAX_LSP = Number(process.env.TYDIG_MAX_LSP || 8), lspsOf = new Map()
let lsps = 0
const syncWss = new WebSocketServer({ noServer: true })
const lspOpen = new Map() // proj -> its open LSP sockets, closed when a member is removed
// An account deleted with a project nobody else is in: the project goes too,
// with its remote settings, deploy key and federation link.
lifecycle.dropProject = async n => {
  if (!isProj(n)) return
  hocuspocus.closeConnections(n); lspOpen.get(n)?.forEach(ws => ws.close())
  for (const f of [proj(n), path.join(DATA, 'gitsync', `${n}.json`), keyOf(n), keyOf(n) + '.pub', path.join(DATA, 'federation', `${n}.json`), agentsFile(n)])
    await rm(f, { recursive: true, force: true })
}
httpServer.on('upgrade', async (req, sock, head) => {
  sock.on('error', () => {}) // a client reset while we await the session must not crash the hub
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/sync' || u.pathname.startsWith('/sync/')) {
    return syncWss.handleUpgrade(req, sock, head, ws => hocuspocus.handleConnection(ws, req))
  }
  if (u.pathname !== '/lsp') return sock.destroy()
  const name = u.searchParams.get('proj')
  if (!isProj(name)) return sock.destroy()
  // Session via cookie (same-origin) or ?t= token (cross-port dev/ws).
  const headers = new Headers()
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie)
  else if (u.searchParams.get('t')) headers.set('cookie', `better-auth.session_token=${u.searchParams.get('t')}`)
  const sess = await sessionFrom(headers)
  if (!originOk(req.headers.origin) || !sess?.user || !await authorizeProject(headers, name) || lsps >= MAX_LSP ||
    (lspsOf.get(sess.user.id) || 0) >= 2) return sock.destroy() // two each: one person cannot take every slot
  lspWss.handleUpgrade(req, sock, head, ws => {
    const open = lspOpen.get(name) ?? lspOpen.set(name, new Set()).get(name)
    open.add(ws); ws.on('close', () => open.delete(ws))
    // tinymist runs in the build sandbox, like any other project code: its
    // commands write files, so on the host it would be a way out of the project.
    const lsp = UNSAFE ? spawn('tinymist', ['lsp'], { cwd: proj(name), stdio: ['pipe', 'pipe', 'ignore'] })
      : (s => ({ stdin: s, stdout: s, on: s.on.bind(s), kill: () => s.destroy() }))(sandbox(name, ['tinymist', 'lsp'], 86400, true))
    const who = sess.user.id
    lsps++; lspsOf.set(who, (lspsOf.get(who) || 0) + 1)
    lsp.on('close', () => { lsps--; lspsOf.set(who, lspsOf.get(who) - 1) })
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
    ws.on('close', bye); lsp.on('close', () => ws.close())
  })
})
