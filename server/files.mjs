// A project's files: list, read, upload, delete, download as .tar.gz,
// import a .zip/.tar(.gz); the last preview a member saw. Text goes through
// the CRDT, the rest to disk.
import express from 'express'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream'
import { unpack } from './unpack.mjs'
import { proj, inProj, okPath, walk, safe, openIn, writeIn, git, live, mirror,
  putFile, fileNow, building, commit, bad, hubFile, writeAtomic } from './store.mjs'

export const QUOTA = Number(process.env.TYDIG_QUOTA_MB || 1000) * 2 ** 20
// every file but .git, .collab and links, at once; one gone meanwhile is left out
const listing = async n => (await Promise.all((await Array.fromAsync(walk(proj(n)))).map(p =>
  lstat(inProj(n, p)).then(s => ({ path: p, size: s.size, mtime: s.mtimeMs }), () => null)))).filter(Boolean)
export const used = async n => (await listing(n)).reduce((b, f) => b + f.size, 0)
const over = async (n, more) => await used(n) + more > QUOTA &&
  `this would pass the project's ${QUOTA / 2 ** 20} MB limit (TYDIG_QUOTA_MB)`
const rel = req => {
  const p = req.params.rel.join('/')
  if (!okPath(p)) throw bad()
  return p
}
// a running build may swap a folder for a symlink: writes wait for it
const idle = (req, res, next) => building.has(req.params.proj)
  ? res.status(409).json({ error: 'a build is running in this project; try again when it ends' }) : next()
const raw = express.raw({ type: () => true, limit: '50mb' })

export const router = express.Router({ mergeParams: true })
router.get('/files', async (req, res) => res.json(await listing(req.params.proj)))
// served sandboxed, and typed only as an image or PDF: anything else is bytes,
// so an uploaded .js, .html or .svg never runs as script in the app
router.get('/raw/*rel', async (req, res) => {
  const p = rel(req), fh = await openIn(req.params.proj, p)
  if (!/\.pdf$/i.test(p)) res.set('Content-Security-Policy', 'sandbox')
  res.type(/\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(p) ? path.extname(p) : 'bin')
    .set('Content-Length', (await fh.stat()).size)
  pipeline(fh.createReadStream(), res, () => {}) // a reader gone mid-way is no error
})
router.put('/raw/*rel', idle, raw, async (req, res) => {
  const n = req.params.proj, err = await over(n, req.body?.length || 0)
  if (err) return res.status(413).json({ error: err })
  await writeIn(n, rel(req), req.body ?? '')
  res.json({ ok: true })
})
router.delete('/raw/*rel', idle, async (req, res) => {
  await rm(await safe(req.params.proj, rel(req)))
  res.json({ ok: true })
})
// sources (what git keeps) or, ?all=1, everything; never .git or .collab
router.get('/archive', async (req, res) => {
  const n = req.params.proj, all = req.query.all === '1'
  const files = all ? ['.'] : (await git(n, 'ls-files', '-z', '-co', '--exclude-standard'))
    .split('\0').filter(f => f && !f.startsWith('.collab/'))
  const tar = spawn('tar', ['-czf', '-', '--exclude=./.git', '--exclude=./.collab', '--null', '-T', '-'],
    { cwd: proj(n), stdio: ['pipe', 'pipe', 'ignore'] })
  tar.on('error', () => {}).stdin.on('error', () => {}).end(files.join('\0')) // tar gone: res says so
  res.attachment(`${n}${all ? '' : '-src'}.tar.gz`).type('application/gzip')
  pipeline(tar.stdout, res, () => tar.kill())
})
// each differing file lands live; nothing is deleted; one checkpoint
router.post('/import', idle, raw, async (req, res) => {
  const n = req.params.proj, pre = okPath(req.query.dir) ? req.query.dir + '/' : ''
  const what = String(req.query.name || 'an archive').replace(/[^\w. -]/g, '_').slice(0, 80)
  let entries
  try { entries = unpack(req.body ?? Buffer.alloc(0), Math.min(QUOTA, 256 << 20)) }
  catch (e) { return res.status(400).json({ error: `${what} is not an archive (.tar.gz, .tar, .zip): ${e.message}` }) }
  const err = await over(n, entries.reduce((a, f) => a + f.data.length, 0))
  if (err) return res.status(413).json({ error: err })
  const report = { added: [], changed: [], same: 0, skipped: [] }
  await live(n, async doc => {
    for (const { path: p0, data } of entries) {
      const p = pre + p0
      if (!okPath(p)) { report.skipped.push(p); continue }
      const cur = await fileNow(n, doc, p)
      if (cur?.equals(data)) { report.same++; continue }
      await putFile(n, doc, p, data);
      (cur ? report.changed : report.added).push(p)
    }
    await mirror(n, doc)
  })
  await commit(n, `checkpoint: imported ${what}`, '--allow-empty')
  res.json(report)
})

// The last preview a member's browser compiled, and the key (a hash) of what
// it shows: a page opens on it before its own compiler has even loaded.
// Served as an image, sandboxed, so nothing in it can run.
router.get('/preview', (req, res) => {
  const f = hubFile(req.params.proj, 'preview.svg')
  if (!existsSync(f)) return res.status(204).end()
  res.set({ 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'no-cache' })
  res.sendFile(f, { dotfiles: 'allow', headers: { 'Content-Type': 'image/svg+xml' } })
})
router.put('/preview', express.text({ type: 'image/svg+xml', limit: '16mb' }), async (req, res) => {
  const key = String(req.query.key || '')
  if (!/^\w{1,32}$/.test(key) || !req.body?.startsWith?.('<svg')) return res.status(400).json({ error: 'not a preview' })
  await mkdir(hubFile(req.params.proj, ''), { recursive: true })
  await writeAtomic(hubFile(req.params.proj, 'preview.svg'), `<!--${key}-->` + req.body)
  res.json({ ok: true })
})
