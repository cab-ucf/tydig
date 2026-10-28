// A git remote as the project's durable home (GitHub, GitLab, a bare repo
// on a NAS): pushed on save, every TYDIG_GIT_PUSH_MINUTES and on shutdown.
// Git keeps the text only: what any hub, a push by hand or an edit on GitHub
// committed merges into the live text three ways. The CRDT stays on its hub
// (store.mjs); an older hub's .collab/crdt/ is read once and taken out.
// The URL may carry a token: it stays in DATA/.hub, never in .git/config.
import express from 'express'
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

const cfg = async n => JSON.parse(await readFile(hubFile(n, 'remote.json'), 'utf8').catch(() => 'null'))
const setCfg = async (n, c) => {
  await mkdir(path.join(HUB, n), { recursive: true })
  await writeFile(hubFile(n, 'remote.json'), JSON.stringify(c), { mode: 0o600 })
}
const redact = u => String(u).replace(/\/\/[^/@]*@/, '//***@')
export const sshUrl = u => /^(git@|ssh:\/\/)/.test(String(u))

// URL and branch reach git as arguments: no options, no local paths (they
// would read other projects) unless TYDIG_GIT_LOCAL=1, no host on the hub's
// own network unless TYDIG_GIT_PRIVATE=1. git@host:path with a / before the
// colon is a local path to git; a host is a name or an address alone (ssh's
// command line is a shell's, store.mjs).
const LOCAL = process.env.TYDIG_GIT_LOCAL === '1'
async function check(url, branch, n) {
  url = String(url || '')
  if (!(/^(https?|ssh):\/\/\S+$|^git@[\w.-]+:\S+$/.test(url) || LOCAL && /^(file:\/\/|\/)\S+$/.test(url)))
    throw new Error(`not a git URL${LOCAL ? '' : ' (local paths need TYDIG_GIT_LOCAL=1)'}`)
  if (!/^(?!-)(?!.*\.\.)[\w./-]{1,100}$/.test(String(branch))) throw new Error('bad branch name')
  // the host as URL reads it (as curl will); nothing a parser could read two ways
  if (/[\\\x00-\x20\x7f]/.test(url)) throw new Error('not a git URL')
  const u = /^\w+:\/\//.test(url) ? new URL(url) : { hostname: /^git@([^:]+):/.exec(url)?.[1] }
  const h = u.hostname?.replace(/^\[|\]$/g, '')
  if (/[^\w.:-]/.test(h)) throw new Error('not a git URL')
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

// an older hub's CRDT files: binary, rewritten whole each sync, so never kept in git
const unstate = async n => rm(await collab(n, 'crdt'), { recursive: true, force: true })
async function outside(n, doc, head) {
  const mb = await git(n, 'merge-base', head, 'FETCH_HEAD').then(s => s.trim(), () => null), files = doc.getMap('files')
  const show = (c, f) => git(n, 'show', `${c}:${f}`).catch(() => null)
  // a history of its own, joined: of its files, those the project lacks (its README)
  const theirsAll = mb ? git(n, 'diff', '--name-only', '-z', mb, 'FETCH_HEAD') : git(n, 'ls-tree', '-r', '--name-only', '-z', 'FETCH_HEAD')
  let merged = 0
  for (const p of (await theirsAll).split('\0')) {
    if (!p || !editable(p) || p.startsWith('.collab/') || !mb && files.has(p)) continue
    const [base, theirs] = await Promise.all([mb && show(mb, p), show('FETCH_HEAD', p)])
    if (theirs?.includes('\0')) continue
    await mergeInto(files, p, base ?? '', theirs); merged++
  }
  return merged
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
      await mirror(n, doc); await unstate(n)
      await commit(n, `tydig sync (${reason})`)
      let pulled = 0
      const head = (await git(n, 'rev-parse', 'HEAD')).trim()
      // a remote with a history of its own (made with a README) is joined to the
      // project's; where both have a file, the project's stays
      if (await git(n, 'fetch', c.url, branch).then(() => true, () => false)) {
        const merge = (...a) => git(n, 'merge', '--no-edit', '-X', 'ours', ...a, 'FETCH_HEAD')
        await merge().catch(e => /unrelated histories/i.test(e.message) ? merge('--allow-unrelated-histories')
          : Promise.reject(e)).catch(async () => { // left in conflict (a binary file): ours
          await git(n, 'checkout', '--ours', '.').catch(() => {})
          await commit(n, 'tydig sync (merge)', '--no-edit')
        })
        pulled = await outside(n, doc, head) // the files the remote changed
        await mirror(n, doc); await unstate(n)
        await commit(n, 'tydig sync (merge)')
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

// a project from a remote: its history taken whole, then the live text from it
export async function adopt(n, url, branch) {
  await check(url, branch ?? 'main', n)
  branch ??= /refs\/heads\/(\S+)\s+HEAD/.exec(await git(n, 'ls-remote', '--symref', url, 'HEAD')
    .catch(() => ''))?.[1] || 'main'
  await check(url, branch, n)
  await setCfg(n, { url, branch })
  await git(n, 'fetch', url, branch)
  await git(n, 'checkout', '-B', branch, 'FETCH_HEAD')
  await live(n, async doc => { await mirror(n, doc); await unstate(n) })
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
