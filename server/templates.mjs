// Templates: folders in TYDIG_TEMPLATES (default templates/). A name is
// built in layers: nih-r21 is nih/ then nih-r21/; base.json puts a family
// on a shared layer (nih on grant); brand-<x>/ goes last. Names that are
// no other's layer are offered.
// Switching merges each file three ways, from what the old template gave
// (.collab/base/) to the new one's, into the project's: yours wins where
// both changed; a file mostly rewritten is put beside yours (main.nih-r21.typ).
import express from 'express'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { proj, inProj, walk, live, mirror, commit, putFile, fileNow, textOf, mergeFile,
  merge3, setText } from './store.mjs'

const DIR = path.resolve(process.env.TYDIG_TEMPLATES || new URL('../templates', import.meta.url).pathname)
const LAYERS = readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
const BASE = existsSync(path.join(DIR, 'base.json')) ? JSON.parse(readFileSync(path.join(DIR, 'base.json'))) : {}
export const BRANDS = LAYERS.filter(l => l.startsWith('brand-')).map(l => l.slice(6))
export const NAMES = ['report', ...LAYERS.filter(t => t !== 'report' && !t.startsWith('brand-') &&
  !Object.values(BASE).includes(t) && !LAYERS.some(u => u.startsWith(t + '-')))]
const layers = (t, brand) => {
  const ls = LAYERS.filter(l => t === l || t.startsWith(l + '-'))
  return [...BASE[ls[0]] ? [BASE[ls[0]]] : [], ...ls, ...BRANDS.includes(brand) ? ['brand-' + brand] : []]
}
// every file a template gives: path -> bytes, later layers winning
async function stack(t, brand) {
  const files = new Map()
  for (const l of layers(t, brand))
    for await (const p of walk(path.join(DIR, l))) files.set(p, await readFile(path.join(DIR, l, p)))
  return files
}
const record = async (dir, template, brand, files) => {
  const b = path.join(dir, '.collab/base')
  await rm(b, { recursive: true, force: true })
  for (const [p, data] of files) {
    await mkdir(path.dirname(path.join(b, p)), { recursive: true })
    await writeFile(path.join(b, p), data)
  }
  await writeFile(path.join(dir, '.collab/template.json'), JSON.stringify({ template, brand: brand || null }))
}
export async function scaffold(n, template, brand) {
  const t = NAMES.includes(template) ? template : 'report'
  for (const l of layers(t, brand)) await cp(path.join(DIR, l), proj(n), { recursive: true })
  await record(proj(n), t, brand, await stack(t, brand))
}
const recorded = async n => JSON.parse(await readFile(inProj(n, '.collab/template.json'), 'utf8').catch(() => 'null'))
async function given(n) { // the files as the template gave them
  const b = inProj(n, '.collab/base'), out = new Map()
  if (existsSync(b)) for await (const p of walk(b)) out.set(p, await readFile(path.join(b, p)))
  return out
}
// the share of a's lines still in b
const kept = (a, b) => { const have = new Set(b.split('\n')), l = a.split('\n'); return l.filter(x => have.has(x)).length / l.length }

async function swap(n, doc, template, brand) {
  const r = { added: [], updated: [], merged: [], kept: [], beside: [], removed: [] }
  const old = await given(n), next = await stack(template, brand), files = doc.getMap('files')
  for (const [p, theirs] of next) {
    const base = old.get(p), cur = await fileNow(n, doc, p)
    if (!cur) { await putFile(n, doc, p, theirs); r.added.push(p); continue }
    if (cur.equals(theirs)) continue
    if (base?.equals(cur)) { await putFile(n, doc, p, theirs); r.updated.push(p); continue }
    const [b, y, t] = [base, cur, theirs].map(x => x && textOf(x))
    if (b != null && y != null && t != null && files.has(p) && kept(b, t) >= 0.5) {
      const { conflicts } = await mergeFile(b, y, t)
      setText(files.get(p), await merge3(b, y, t)); r.merged.push(p)
      if (conflicts) r.kept.push([p, conflicts])
      continue
    }
    const side = p.replace(/(\.[^./]+)?$/, `.${template}$1`)
    await putFile(n, doc, side, theirs); r.beside.push([p, side])
  }
  for (const [p, b] of old) if (!next.has(p) && (await fileNow(n, doc, p))?.equals(b)) {
    files.has(p) ? files.delete(p) : await rm(inProj(n, p), { force: true }); r.removed.push(p)
  }
  await mirror(n, doc)
  return r
}

export const list = (req, res) => res.json({ templates: NAMES, brands: BRANDS })
export const router = express.Router({ mergeParams: true })
router.get('/template', async (req, res) => {
  const r = await recorded(req.params.proj)
  res.json({ ...r, recorded: !!r, templates: NAMES, brands: BRANDS })
})
router.post('/template', async (req, res) => {
  if (!['owner', 'admin'].includes(req.org.role)) return res.status(403).json({ error: 'only the owner or an admin' })
  const n = req.params.proj, { template, brand = null } = req.body || {}
  if (!NAMES.includes(template) || (brand && !BRANDS.includes(brand)))
    return res.status(400).json({ error: 'no such template or brand' })
  const from = await recorded(n), report = await live(n, doc => swap(n, doc, template, brand))
  await record(proj(n), template, brand, await stack(template, brand))
  const name = t => t ? t.template + (t.brand ? '+' + t.brand : '') : 'none'
  await commit(n, `checkpoint: template ${name(from)} -> ${name({ template, brand })}`)
  res.json({ from, ...report })
})
