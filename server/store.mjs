// Projects: a git repo each under DATA. Text lives in a Yjs map ('files':
// path -> Y.Text), mirrored to disk on save; binaries live on disk only.
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { existsSync, watch, mkdirSync, constants as FS } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from './migrate.mjs'
import { setText } from './text.mjs'

export const run = promisify(execFile)
export const DATA = path.resolve(process.env.TYDIG_DATA || 'data')
// what the hub keeps per project outside it: remote, deploy key, agents
export const HUB = path.join(DATA, '.hub')
mkdirSync(HUB, { recursive: true, mode: 0o700 })
migrate(DATA, HUB)

export const GEN = /^(out|build|figures)\// // build output: disk only
export const okName = n => /^[\w-]{1,64}$/.test(n)
export const okPath = p => typeof p === 'string' && p.length < 256 && /^[\w./@ -]+$/.test(p) &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
export const editable = p => okPath(p) && !GEN.test(p)
export const proj = n => path.join(DATA, n)
export const inProj = (n, p) => path.join(DATA, n, p)
export const hubFile = (n, f) => path.join(HUB, n, f)
export const isProj = n => okName(n) && existsSync(inProj(n, '.git'))
// projects being removed: nothing writes them again (a save may be under way)
export const dropped = new Set()
// whole or not at all, and never two writers in one temporary file
export async function writeAtomic(f, data, mode) {
  const tmp = `${f}.${randomUUID()}`
  try { await fs.writeFile(tmp, data, { mode }); await fs.rename(tmp, f) }
  finally { await fs.rm(tmp, { force: true }) }
}

// text: UTF-8, no NUL, under 1 MB, whatever the name
const utf8 = new TextDecoder('utf-8', { fatal: true })
export const textOf = b => {
  if (b.length >= 1e6 || b.includes(0)) return null
  try { return utf8.decode(b) } catch { return null }
}

// git, one call at a time per project; never prompts, never runs a build's
// fsmonitor nor follows a redirect (to a host never checked); ssh with the
// project's deploy key only
const KNOWN = path.join(HUB, 'known_hosts')
if (!existsSync(KNOWN)) await fs.writeFile(KNOWN, 'github.com ssh-ed25519 ' +
  'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n')
const ssh = n => `ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=accept-new` +
  ` -o UserKnownHostsFile='${KNOWN}' -o IdentitiesOnly=yes -o IdentityAgent=none` +
  ` -i '${hubFile(n, 'key')}'`
// a remote's host as checked public (remote.mjs): git connects to that address,
// never to what the name resolves to a moment later (DNS rebinding)
export const gitPin = new Map() // project -> { host, port, ip }
const gitQ = new Map()
export const git = (n, ...a) => {
  const p = gitPin.get(n), ip = p && (p.ip.includes(':') ? `[${p.ip}]` : p.ip)
  const cfg = [['core.fsmonitor', 'false'], ['http.followRedirects', 'false'],
    ...p ? [['http.curloptResolve', `${p.host}:${p.port}:${ip}`]] : []]
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: ssh(n) + (p ? ` -o HostName=${p.ip} -o HostKeyAlias=${p.host}` : ''), GIT_CONFIG_COUNT: String(cfg.length),
    ...Object.fromEntries(cfg.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])) }
  const r = (gitQ.get(n) || Promise.resolve()).then(() =>
    run('git', ['-C', proj(n), ...a], { maxBuffer: 1 << 28, timeout: 600_000, env }))
  gitQ.set(n, r.catch(() => {}))
  return r.then(r => r.stdout)
}
export const commit = (n, msg, ...flags) =>
  git(n, 'add', '-A').then(() => git(n, 'commit', '-q', ...flags, '-m', msg)).catch(() => {})
export async function ensureRepo(n) {
  if (existsSync(inProj(n, '.git'))) return
  await fs.mkdir(proj(n), { recursive: true })
  await git(n, 'init', '-q', '-b', 'main')
}

// Files inside the project only: no symlink, no swapped directory (the
// kernel says where the open file is).
export const bad = () => Object.assign(new Error('bad path'), { status: 400 })
export async function safe(n, rel) {
  const f = inProj(n, rel), root = await fs.realpath(proj(n)) + path.sep
  const d = await fs.realpath(path.dirname(f)).catch(() => '')
  if (!(d + path.sep).startsWith(root) || (await fs.lstat(f).catch(() => null))?.isSymbolicLink()) throw bad()
  return f
}
export async function openIn(n, rel, write) {
  // never blocks on a fifo a build left, and only a regular file is used
  const flags = (write ? FS.O_WRONLY | FS.O_CREAT : FS.O_RDONLY) | (FS.O_NOFOLLOW || 0) | (FS.O_NONBLOCK || 0)
  const fh = await fs.open(await safe(n, rel), flags, 0o644)
  if (!(await fh.stat()).isFile()) { await fh.close(); throw bad() }
  const at = await fs.realpath(`/proc/self/fd/${fh.fd}`).catch(() => null)
  if (at && !at.startsWith(await fs.realpath(proj(n)) + path.sep)) { await fh.close(); throw bad() }
  return fh
}
export async function readIn(n, rel) {
  const fh = await openIn(n, rel)
  try { return await fh.readFile() } finally { await fh.close() }
}
export async function writeIn(n, rel, data) {
  await fs.mkdir(path.dirname(inProj(n, rel)), { recursive: true })
  const fh = await openIn(n, rel, true)
  try { await fh.truncate(0); await fh.writeFile(data) } finally { await fh.close() }
}
export async function* walk(dir, base = dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.collab' || e.isSymbolicLink()) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, base)
    else yield path.relative(base, p).replaceAll('\\', '/')
  }
}

export const putText = (files, rel, s) => files.has(rel) ? setText(files.get(rel), s)
  : files.set(rel, new Y.Text(s))

// git merge-file: the merged text and how many places both sides changed
export async function mergeFile(base, ours, theirs, ...flags) {
  const d = await fs.mkdtemp(path.join(tmpdir(), 'tydig-'))
  try {
    const f = ['ours', 'base', 'theirs'].map(x => path.join(d, x))
    await Promise.all([ours, base, theirs].map((t, i) => fs.writeFile(f[i], t)))
    const r = await run('git', ['merge-file', '-p', ...flags, ...f]).catch(e => e)
    return { text: r.stdout, conflicts: typeof r.code === 'number' ? r.code : 0 }
  } finally { fs.rm(d, { recursive: true, force: true }) }
}
// an outside edit (agent, shell, git) into the live text; the live text
// wins where both changed the same lines
export const merge3 = async (base, ours, theirs) =>
  theirs === base || theirs === ours ? ours : ours === base ? theirs
    : (await mergeFile(base, ours, theirs, '--ours')).text
// theirs (an outside edit of base; null: deleted) into the live text at p,
// merged again should someone type while it merges: no keystroke is lost
export async function mergeInto(files, p, base, theirs) {
  for (;;) {
    const ours = files.get(p)?.toString()
    const s = theirs == null || ours == null || base == null ? theirs : await merge3(base, ours, theirs)
    if (files.get(p)?.toString() === ours) return s == null ? files.delete(p) : putText(files, p, s)
  }
}

export const building = new Set() // projects with a build running
const mirrored = new Map() // proj -> Map path -> text last written

// The working tree as a rendering of the CRDT: write what changed, delete
// what left (not mid-build: a build may have swapped a folder for a link).
export async function mirror(n, doc) {
  if (dropped.has(n)) return
  await ensureRepo(n)
  const last = mirrored.get(n) ?? mirrored.set(n, new Map()).get(n), now = new Set()
  for (const [rel, t] of doc.getMap('files')) {
    if (dropped.has(n)) return
    if (!editable(rel)) continue
    now.add(rel)
    const s = t.toString()
    if (last.get(rel) === s && existsSync(inProj(n, rel))) continue
    await writeIn(n, rel, s).then(() => last.set(rel, s), e => console.warn(`mirror ${rel}: ${e.message}`))
  }
  for (const rel of last.keys()) if (!now.has(rel) && !building.has(n)) {
    last.delete(rel)
    await safe(n, rel).then(f => fs.rm(f, { force: true })).catch(() => {})
  }
}

// Disk changes (builds, shells, agents, pulls) reach the CRDT: new text is
// added, deleted files leave, edits merge from what the hub last wrote.
// Anything new on disk bumps meta.diskRev, so previews refresh.
const watchers = new Map()
function watchProject(n, doc) {
  if (watchers.has(n)) return
  const seen = new Set()
  let t
  watchers.set(n, watch(proj(n), { recursive: true }, (_, f) => {
    f = f?.replaceAll('\\', '/') // .git/ is git's; .gitattributes and .gitignore are the project's
    if (!f || f === '.git' || f.startsWith('.git/')) return
    seen.add(f)
    clearTimeout(t)
    t = setTimeout(async () => {
      const files = doc.getMap('files'), rels = [...seen], ops = []
      seen.clear()
      let merged = 0
      for (const rel of rels) {
        if (!existsSync(inProj(n, rel))) {
          ops.push(...[...files.keys()].filter(k => k === rel || k.startsWith(rel + '/')).map(k => [k, null]))
          continue
        }
        if (!editable(rel)) continue
        const b = await readIn(n, rel).catch(() => null), s = b && textOf(b)
        const base = mirrored.get(n)?.get(rel)
        if (s == null) continue
        if (!files.has(rel)) ops.push([rel, s])
        else if (base != null && s !== base) merged++, await mergeInto(files, rel, base, s)
      }
      doc.transact(() => {
        for (const [rel, s] of ops) s == null ? files.delete(rel) : putText(files, rel, s)
      })
      if (ops.length || merged || rels.some(rel => !files.has(rel))) doc.getMap('meta').set('diskRev', Date.now())
    }, 400)
  }).on('error', () => {})) // the folder went (the project was removed)
}

// .collab/ is the hub's: peer hubs' CRDT state, the template's record. It
// comes from git remotes and adopted repos, so a link anywhere in it could
// lead into another project: links are removed, never followed.
export async function collab(n, rel = '') {
  const root = inProj(n, '.collab')
  const clean = async d => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => []))
    e.isDirectory() ? await clean(path.join(d, e.name)) : e.isFile() || await fs.rm(path.join(d, e.name)) }
  if ((await fs.lstat(root).catch(() => null))?.isSymbolicLink()) await fs.rm(root)
  await clean(root)
  return path.join(root, rel)
}

// This hub's CRDT state lives in .git (never committed); peer hubs' in
// .collab/crdt/ (from the git remote). Text newer on disk wins.
const crdtFile = n => inProj(n, '.git/tydig-crdt')
async function load(n, doc) {
  const files = doc.getMap('files'), peers = await collab(n, 'crdt')
  const states = [crdtFile(n), ...existsSync(peers)
    ? (await fs.readdir(peers)).filter(f => f.endsWith('.bin')).map(f => path.join(peers, f)) : []]
  for (const f of states.filter(existsSync))
    try { Y.applyUpdate(doc, await fs.readFile(f)) } catch (e) { console.warn(`${f}: ${e.message}`) }
  const saved = existsSync(crdtFile(n)) ? (await fs.stat(crdtFile(n))).mtimeMs : Infinity, texts = []
  for await (const rel of walk(proj(n))) {
    if (!editable(rel)) continue
    const s = await fs.lstat(inProj(n, rel)).catch(() => null) // a build may be swapping it
    if (!s?.isFile() || s.size >= 1e6 || (files.has(rel) && s.mtimeMs <= saved)) continue
    const b = await readIn(n, rel).catch(() => null), t = b && textOf(b)
    if (t != null) texts.push([rel, t])
  }
  doc.transact(() => texts.forEach(([rel, t]) => putText(files, rel, t)))
  mirrored.set(n, new Map([...files.keys()].map(k => [k, null]))) // first save writes all
  watchProject(n, doc)
}

// State first, then the tree: a crash between leaves the disk older,
// which the next load ignores.
export async function save(n, doc) {
  if (!isProj(n) || dropped.has(n)) return
  await writeAtomic(crdtFile(n), Y.encodeStateAsUpdate(doc))
  await mirror(n, doc)
  await commit(n, 'autosave')
}

export const hocuspocus = Server.configure({
  debounce: 2000,
  onLoadDocument: async ({ documentName: n, document: doc }) => {
    if (isProj(n) && !doc.getMap('files').size) await load(n, doc)
    return doc
  },
  afterUnloadDocument: async ({ documentName: n }) => { watchers.get(n)?.close(); watchers.delete(n) },
  onStoreDocument: ({ documentName: n, document: doc }) => save(n, doc),
})

// f(doc) with the project's live document open
export async function live(n, f) {
  const dc = await hocuspocus.openDirectConnection(n, {})
  try { return await f(dc.document) } finally { await dc.disconnect().catch(() => {}) }
}
// a file into the live project: text into the CRDT, the rest to disk
export async function putFile(n, doc, rel, b) {
  const t = textOf(b)
  if (t != null && !GEN.test(rel)) putText(doc.getMap('files'), rel, t)
  else await writeIn(n, rel, b)
}
export async function fileNow(n, doc, rel) {
  const t = doc.getMap('files').get(rel)
  return t ? Buffer.from(t.toString()) : readIn(n, rel).catch(() => null)
}
