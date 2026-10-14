// Projects: a git repo each under DATA. Text lives in a Yjs map ('files':
// path -> Y.Text), mirrored to disk on save; binaries live on disk only.
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { existsSync, watch, mkdirSync, constants as FS } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from './migrate.mjs'

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

// text: UTF-8, no NUL, under 1 MB, whatever the name
const utf8 = new TextDecoder('utf-8', { fatal: true })
export const textOf = b => {
  if (b.length >= 1e6 || b.includes(0)) return null
  try { return utf8.decode(b) } catch { return null }
}

// git, one call at a time per project; never prompts, never runs a build's
// fsmonitor; ssh with the project's deploy key only
const KNOWN = path.join(HUB, 'known_hosts')
if (!existsSync(KNOWN)) await fs.writeFile(KNOWN, 'github.com ssh-ed25519 ' +
  'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n')
const ssh = n => `ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=accept-new` +
  ` -o UserKnownHostsFile='${KNOWN}' -o IdentitiesOnly=yes -o IdentityAgent=none` +
  ` -i '${hubFile(n, 'key')}'`
const gitQ = new Map()
export const git = (n, ...a) => {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: ssh(n),
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' }
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
const bad = () => Object.assign(new Error('bad path'), { status: 400 })
export async function safe(n, rel) {
  const f = inProj(n, rel), root = await fs.realpath(proj(n)) + path.sep
  const d = await fs.realpath(path.dirname(f)).catch(() => '')
  if (!(d + path.sep).startsWith(root) || (await fs.lstat(f).catch(() => null))?.isSymbolicLink()) throw bad()
  return f
}
export async function openIn(n, rel, write) {
  const flags = (write ? FS.O_WRONLY | FS.O_CREAT : FS.O_RDONLY) | (FS.O_NOFOLLOW || 0)
  const fh = await fs.open(await safe(n, rel), flags, 0o644)
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

// Replace a Y.Text's content by its changed span alone, so comment anchors
// and concurrent edits elsewhere survive. Never splits a surrogate pair.
export function setText(t, s) {
  const o = t.toString(), hi = i => (o.charCodeAt(i) & 0xFC00) === 0xD800
  if (o === s) return
  let a = 0, b = 0
  while (a < o.length && o[a] === s[a]) a++
  if (a && hi(a - 1)) a--
  while (b < o.length - a && b < s.length - a && o.at(-1 - b) === s.at(-1 - b)) b++
  if (b && hi(o.length - b - 1)) b--
  t.delete(a, o.length - a - b); t.insert(a, s.slice(a, s.length - b))
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

export const building = new Set() // projects with a build running
const mirrored = new Map() // proj -> Map path -> text last written

// The working tree as a rendering of the CRDT: write what changed, delete
// what left (not mid-build: a build may have swapped a folder for a link).
export async function mirror(n, doc) {
  await ensureRepo(n)
  const last = mirrored.get(n) ?? mirrored.set(n, new Map()).get(n), now = new Set()
  for (const [rel, t] of doc.getMap('files')) {
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
    if (!f || f.startsWith('.git')) return
    seen.add(f.replaceAll('\\', '/'))
    clearTimeout(t)
    t = setTimeout(async () => {
      const files = doc.getMap('files'), rels = [...seen], ops = []
      seen.clear()
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
        else if (base != null && s !== base) ops.push([rel, await merge3(base, files.get(rel).toString(), s)])
      }
      doc.transact(() => {
        for (const [rel, s] of ops) s == null ? files.delete(rel) : putText(files, rel, s)
      })
      if (ops.length || rels.some(rel => !files.has(rel))) doc.getMap('meta').set('diskRev', Date.now())
    }, 400)
  }))
}

// This hub's CRDT state lives in .git (never committed); peer hubs' in
// .collab/crdt/ (from the git remote). Text newer on disk wins.
const crdtFile = n => inProj(n, '.git/tydig-crdt')
async function load(n, doc) {
  const files = doc.getMap('files'), peers = inProj(n, '.collab/crdt')
  const states = [crdtFile(n), ...existsSync(peers)
    ? (await fs.readdir(peers)).filter(f => f.endsWith('.bin')).map(f => path.join(peers, f)) : []]
  for (const f of states.filter(existsSync))
    try { Y.applyUpdate(doc, await fs.readFile(f)) } catch (e) { console.warn(`${f}: ${e.message}`) }
  const saved = existsSync(crdtFile(n)) ? (await fs.stat(crdtFile(n))).mtimeMs : Infinity, texts = []
  for await (const rel of walk(proj(n))) {
    if (!editable(rel)) continue
    const s = await fs.stat(inProj(n, rel))
    if (s.size >= 1e6 || (files.has(rel) && s.mtimeMs <= saved)) continue
    const t = textOf(await fs.readFile(inProj(n, rel)))
    if (t != null) texts.push([rel, t])
  }
  doc.transact(() => texts.forEach(([rel, t]) => putText(files, rel, t)))
  mirrored.set(n, new Map([...files.keys()].map(k => [k, null]))) // first save writes all
  watchProject(n, doc)
}

// State first, then the tree: a crash between leaves the disk older,
// which the next load ignores.
export async function save(n, doc) {
  if (!isProj(n)) return
  const tmp = `${crdtFile(n)}.${process.pid}`
  await fs.writeFile(tmp, Y.encodeStateAsUpdate(doc))
  await fs.rename(tmp, crdtFile(n))
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
