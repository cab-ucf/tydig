// A project's files: list, read, upload, delete, download as .tar.gz,
// import a .zip/.tar(.gz). Text goes through the CRDT, the rest to disk.
import express from 'express'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { lstat, rm, stat } from 'node:fs/promises'
import { unpack } from './unpack.mjs'
import { proj, inProj, okPath, walk, safe, openIn, writeIn, git, live, mirror,
  putFile, fileNow, building, commit } from './store.mjs'

const QUOTA = Number(process.env.TYDIG_QUOTA_MB || 1000) * 2 ** 20
const used = async n => {
  let b = 0
  for await (const rel of walk(proj(n))) b += (await lstat(inProj(n, rel)).catch(() => ({ size: 0 }))).size
  return b
}
const over = async (n, more) => await used(n) + more > QUOTA &&
  `this would pass the project's ${QUOTA / 2 ** 20} MB limit (TYDIG_QUOTA_MB)`
const rel = req => {
  const p = req.params.rel.join('/')
  if (!okPath(p)) throw Object.assign(new Error('bad path'), { status: 400 })
  return p
}
// a running build may swap a folder for a symlink: writes wait for it
const idle = (req, res, next) => building.has(req.params.proj)
  ? res.status(409).json({ error: 'a build is running in this project; try again when it ends' }) : next()
const raw = express.raw({ type: () => true, limit: '50mb' })

export const router = express.Router({ mergeParams: true })
router.get('/files', async (req, res) => {
  const n = req.params.proj, out = []
  for await (const p of walk(proj(n))) {
    const s = await stat(inProj(n, p))
    out.push({ path: p, size: s.size, mtime: s.mtimeMs })
  }
  res.json(out)
})
// served sandboxed, and typed only as an image or PDF: anything else is bytes,
// so an uploaded .js, .html or .svg never runs as script in the app
router.get('/raw/*rel', async (req, res) => {
  const p = rel(req), fh = await openIn(req.params.proj, p)
  if (!/\.pdf$/i.test(p)) res.set('Content-Security-Policy', 'sandbox')
  res.type(/\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(p) ? path.extname(p) : 'bin')
    .set('Content-Length', (await fh.stat()).size)
  fh.createReadStream().pipe(res)
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
  tar.stdin.end(files.join('\0'))
  res.attachment(`${n}${all ? '' : '-src'}.tar.gz`).type('application/gzip')
  tar.stdout.pipe(res)
  res.on('close', () => tar.kill())
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
