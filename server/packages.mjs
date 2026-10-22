// Typst Universe through the hub: the packages a document imports, for the
// preview (the page talks to the hub alone), and its templates, to start a
// project from. Each package fetched once, kept in DATA/.hub/.packages.
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { HUB, writeAtomic } from './store.mjs'
import { unpack } from './unpack.mjs'

const U = (process.env.TYDIG_PACKAGES || 'https://packages.typst.org').replace(/\/$/, '')
const DIR = path.join(HUB, '.packages')
const FILE = /^([a-z0-9][a-z0-9-]*)-(\d+\.\d+\.\d+)\.tar\.gz$/
export const SPEC = /^@preview\/([a-z0-9][a-z0-9-]*):(\d+\.\d+\.\d+)$/
const fail = (status, message) => Object.assign(new Error(message), { status })

// a package's .tar.gz (immutable, as Universe publishes them: a version never changes)
export async function tarball(f) {
  if (!FILE.test(f)) throw fail(400, 'not a package')
  const at = path.join(DIR, f)
  if (existsSync(at)) return readFile(at)
  const r = await fetch(`${U}/preview/${f}`).catch(e => { throw fail(502, `Typst Universe: ${e.message}`) })
  if (!r.ok) throw fail(r.status === 404 ? 404 : 502, `Typst Universe has no ${f.replace(FILE, '@preview/$1:$2')}`)
  const b = Buffer.from(await r.arrayBuffer())
  if (b.length > 64 << 20) throw fail(413, `${f} is over 64 MB`)
  await mkdir(DIR, { recursive: true }); await writeAtomic(at, b)
  return b
}

// The templates people reach for, each checked to compile with this hub's typst
export const FEATURED = Object.entries({
  journal: 'IEEE charged-ieee:0.1.4, ACM faithful-acmart:0.2.0, Springer LNCS fine-lncs:0.6.5, ' +
    'Springer Nature stellar-springer-nature:0.1.0, Elsevier elspub:1.0.0, APA 7 versatile-apa:7.2.0, ' +
    'arXiv preprint arkheion:0.1.2, MDPI splendid-mdpi:0.1.0, Physical Review revtyp:0.15.0, ' +
    'IOP ioppub:0.1.1, NeurIPS bloated-neurips:0.8.0',
  poster: 'peace of posters peace-of-posters:0.6.0, Pollux pollux:0.1.0, Placard placard:0.1.0, ' +
    'simple research simple-research-poster:0.2.0, Pasquino pasquino:0.1.0',
}).flatMap(([kind, s]) => s.split(', ').map(x => {
  const [, label, spec] = /^(.*) (\S+)$/.exec(x)
  return { kind, label, spec: '@preview/' + spec }
}))

// a template's files: the folder its typst.toml names, path -> bytes; its
// entry main.typ, as tydig's are (the preview opens on it)
export async function template(spec) {
  const [, name, version] = SPEC.exec(spec) || []
  if (!name) throw fail(400, 'not a Typst Universe template')
  const files = unpack(await tarball(`${name}-${version}.tar.gz`), 256 << 20)
  const toml = files.find(f => f.path === 'typst.toml')?.data.toString() ?? ''
  const dir = /\[template\][^[]*?\bpath\s*=\s*"([^"]+)"/.exec(toml)?.[1].replace(/^\.\/|\/$/g, '')
  if (!dir) throw fail(400, `${spec} is a package, not a template`)
  const out = new Map(files.filter(f => f.path.startsWith(dir + '/')).map(f => [f.path.slice(dir.length + 1), f.data]))
  const entry = /\[template\][^[]*?\bentrypoint\s*=\s*"([^"]+)"/.exec(toml)?.[1]
  if (entry && out.has(entry) && !out.has('main.typ')) out.set('main.typ', out.get(entry)).delete(entry)
  return out
}

// every Universe template, its latest version: read once a day
let index = null
const templates = () => {
  if (!index || Date.now() - index.at > 864e5) index = { at: Date.now(), list: fetch(`${U}/preview/index.json`)
    .then(r => r.ok ? r.json() : Promise.reject(fail(502, `Typst Universe: ${r.status}`)))
    .then(all => [...new Map(all.filter(p => p.template).map(p => [p.name, {
      spec: `@preview/${p.name}:${p.version}`, description: p.description ?? '', categories: p.categories ?? [] }]))
      .values()]).catch(e => { index = null; throw e }) }
  return index.list
}

export const router = express.Router()
  .get('/packages/preview/:f', async (req, res) => {
    try { res.type('application/gzip').set('Cache-Control', 'private, max-age=31536000, immutable').send(await tarball(req.params.f)) }
    catch (e) { res.status(e.status || 502).json({ error: e.message }) }
  })
  .get('/universe', async (req, res) => {
    try { res.json(await templates()) } catch (e) { res.status(e.status || 502).json({ error: e.message }) }
  })
