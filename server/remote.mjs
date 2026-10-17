// A git remote as the project's durable home (GitHub, GitLab, a bare repo
// on a NAS): pushed on save, every TYDIG_GIT_PUSH_MINUTES and on shutdown.
// Hubs never conflict: each writes only .collab/crdt/<hub id>.bin, and the
// merged CRDT regenerates the working tree. Commits no hub made (a push by
// hand, an edit on GitHub) merge into the live text three ways.
// The URL may carry a token: it stays in DATA/.hub, never in .git/config.
import express from 'express'
import * as Y from 'yjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DATA, HUB, git, run, commit, live, mirror, editable, hubFile,
  isProj, mergeInto, collab, gitPin } from './store.mjs'
import { admin } from './auth.mjs'
import { publicOnly } from './public.mjs'

const idFile = path.join(DATA, 'hub-id')
if (!existsSync(idFile)) writeFileSync(idFile, randomBytes(8).toString('hex') + '\n')
export const hubId = readFileSync(idFile, 'utf8').trim()
const MINE = `.collab/crdt/${hubId}.bin`

const cfg = async n => JSON.parse(await readFile(hubFile(n, 'remote.json'), 'utf8').catch(() => 'null'))
const setCfg = async (n, c) => {
  await mkdir(path.join(HUB, n), { recursive: true })
  await writeFile(hubFile(n, 'remote.json'), JSON.stringify(c), { mode: 0o600 })
}
const redact = u => String(u).replace(/\/\/[^/@]*@/, '//***@')
export const sshUrl = u => /^(git@|ssh:\/\/)/.test(String(u))

// URL and branch reach git as arguments: no options, no local paths (they
// would read other projects) unless TYDIG_GIT_LOCAL=1, no host on the hub's
// own network unless TYDIG_GIT_PRIVATE=1
const LOCAL = process.env.TYDIG_GIT_LOCAL === '1'
async function check(url, branch, n) {
  if (!(LOCAL ? /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)\S+$/ : /^(https?:\/\/|git@|ssh:\/\/)\S+$/).test(String(url || '')))
    throw new Error(`not a git URL${LOCAL ? '' : ' (local paths need TYDIG_GIT_LOCAL=1)'}`)
  if (!/^(?!-)(?!.*\.\.)[\w./-]{1,100}$/.test(String(branch))) throw new Error('bad branch name')
  // the host as URL reads it (as curl will); nothing a parser could read two ways
  if (/[\\\x00-\x20\x7f]/.test(url)) throw new Error('not a git URL')
  const u = /^\w+:\/\//.test(url) ? new URL(url) : { hostname: /^[\w.-]+@([^:/]+):/.exec(url)?.[1] }
  const h = u.hostname?.replace(/^\[|\]$/g, '')
  if (!h || process.env.TYDIG_GIT_PRIVATE === '1') return n && gitPin.delete(n)
  const [{ address }] = await publicOnly(h)
    .catch(e => { throw new Error(`${e.message}; TYDIG_GIT_PRIVATE=1 allows it`) })
  if (n) gitPin.set(n, { host: h, port: u.port || (u.protocol === 'http:' ? 80 : 443), ip: address })
}

// What a failed adoption left (its deploy key: add it, then try again) is
// for whoever tried; anyone else making a project of that name starts clean.
export async function claim(n, uid) {
  const d = path.join(HUB, n), f = path.join(d, 'for')
  if (existsSync(d) && await readFile(f, 'utf8').catch(() => '') !== uid) await rm(d, { recursive: true, force: true })
  await mkdir(d, { recursive: true }); await writeFile(f, uid)
}
// a failed adoption keeps the key, not the URL (it may hold a token)
export const unadopt = n => rm(hubFile(n, 'remote.json'), { force: true })

// the project's own SSH key, for a private repo's deploy key
export async function deployKey(n) {
  const k = hubFile(n, 'key')
  if (!existsSync(k)) {
    await mkdir(path.dirname(k), { recursive: true })
    await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `tydig:${n}`, '-f', k])
  }
  return (await readFile(k + '.pub', 'utf8')).trim()
}

async function absorb(n, doc) {
  const dir = await collab(n, 'crdt'), peers = existsSync(dir)
    ? (await readdir(dir)).filter(f => f.endsWith('.bin') && f !== `${hubId}.bin`) : []
  for (const f of peers) try { Y.applyUpdate(doc, await readFile(path.join(dir, f))) } catch {}
  return peers.length
}
async function writeState(n, doc) {
  await mkdir(await collab(n, 'crdt'), { recursive: true })
  await writeFile(await collab(n, `crdt/${hubId}.bin`), Y.encodeStateAsUpdate(doc), { flag: 'w' })
}
async function outside(n, doc, head) {
  const mb = (await git(n, 'merge-base', head, 'FETCH_HEAD')).trim(), files = doc.getMap('files')
  const show = (c, f) => git(n, 'show', `${c}:${f}`).catch(() => null)
  for (const p of (await git(n, 'diff', '--name-only', '-z', mb, 'FETCH_HEAD')).split('\0')) {
    if (!editable(p) || p.startsWith('.collab/')) continue
    const [base, theirs] = await Promise.all([show(mb, p), show('FETCH_HEAD', p)])
    if (theirs?.includes('\0')) continue
    await mergeInto(files, p, base ?? '', theirs)
  }
}

const inFlight = new Map()
export function sync(n, reason = 'manual') {
  if (inFlight.has(n)) return inFlight.get(n)
  const task = (async () => {
    const c = await cfg(n)
    if (!c?.url) return { skipped: 'no remote' }
    const branch = c.branch || 'main'
    await check(c.url, branch, n)
    return live(n, async doc => {
      await git(n, 'remote', 'remove', 'origin').catch(() => {})
      await git(n, 'branch', '-M', branch).catch(() => {})
      await mirror(n, doc); await writeState(n, doc)
      await commit(n, `tydig sync (${reason})`)
      let pulled = 0
      const head = (await git(n, 'rev-parse', 'HEAD')).trim()
      // never unrelated histories: a project made from the URL takes those
      if (await git(n, 'fetch', c.url, branch).then(() => true, () => false)) {
        const merged = await git(n, 'merge', '--no-edit', '-X', 'ours', 'FETCH_HEAD').then(() => true, async e => {
          if (/unrelated histories|refusing to merge/i.test(e.message))
            return console.warn(`remote: ${n} holds another history: make a project from its URL`), false
          await git(n, 'checkout', '--ours', '.').catch(() => {})
          await commit(n, 'tydig sync (merge)', '--no-edit')
          return true
        })
        if (merged) {
          pulled = await absorb(n, doc)
          await outside(n, doc, head)
          await mirror(n, doc); await writeState(n, doc)
          await commit(n, 'tydig sync (merge)')
        }
      }
      // notes under this hub's own namespace: one writer per ref
      let why = ''
      const ok = await git(n, 'push', c.url, branch, `refs/notes/*:refs/notes/${hubId}/*`).then(() => true, e => {
        const l = String(e.stderr || e.message).trim().split('\n')
        why = redact(l.find(x => /denied|refused|rejected|not found|could not|fatal|error/i.test(x)) || l.pop())
        return false
      })
      Object.assign(c, { lastSync: new Date().toISOString(), lastError: ok ? null : `push failed: ${why}` })
      await setCfg(n, c)
      console.log(`remote: ${n} ${ok ? 'pushed' : 'push failed'} (${reason})`)
      return { ok, pulled, at: c.lastSync, error: c.lastError }
    })
  })().finally(() => inFlight.delete(n))
  inFlight.set(n, task)
  return task
}

// a project from a remote: its history taken whole, then the CRDT from it
export async function adopt(n, url, branch) {
  await check(url, branch ?? 'main', n)
  branch ??= /refs\/heads\/(\S+)\s+HEAD/.exec(await git(n, 'ls-remote', '--symref', url, 'HEAD')
    .catch(() => ''))?.[1] || 'main'
  await check(url, branch, n)
  await setCfg(n, { url, branch })
  await git(n, 'fetch', url, branch)
  await git(n, 'checkout', '-B', branch, 'FETCH_HEAD')
  await live(n, async doc => { await mirror(n, doc); await writeState(n, doc) })
  await commit(n, 'tydig: adopted from git remote')
}

export async function status(n) {
  const c = await cfg(n)
  return c?.url ? { configured: true, url: redact(c.url), branch: c.branch || 'main', hubId,
    lastSync: c.lastSync || null, lastError: c.lastError || null } : { configured: false, hubId }
}
const remotes = async () => existsSync(HUB) ? (await readdir(HUB)).filter(n => isProj(n)) : []
export async function syncAll(reason) {
  for (const n of await remotes()) if ((await cfg(n))?.url) await sync(n, reason).catch(e => console.warn(`remote: ${n}: ${e.message}`))
}
export const start = () => setInterval(() => syncAll('periodic'),
  Number(process.env.TYDIG_GIT_PUSH_MINUTES || 5) * 60_000).unref()

const withKey = async n => ({ ...await status(n), key: existsSync(hubFile(n, 'key')) ? await deployKey(n) : null })
export const router = express.Router({ mergeParams: true })
router.get('/gitremote', async (req, res) => res.json(await withKey(req.params.proj)))
router.post('/gitremote', admin, async (req, res) => {
  const n = req.params.proj, { url, branch = 'main' } = req.body || {}
  try {
    await check(url, branch)
    await setCfg(n, { ...await cfg(n), url, branch })
    if (sshUrl(url)) await deployKey(n)
    res.json(await withKey(n))
  } catch (e) { res.status(400).json({ error: e.message }) }
})
router.delete('/gitremote', admin, async (req, res) => { await setCfg(req.params.proj, {}); res.json({ ok: true }) })
router.post('/gitremote/sync', admin, async (req, res) => {
  try { res.json(await sync(req.params.proj, 'requested')) } catch (e) { res.status(400).json({ error: e.message }) }
})
