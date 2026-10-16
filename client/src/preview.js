// The live preview: typst compiled in the browser on every edit, with comment
// pins; which file is missing when one is; PDF and Word export; zoom and fit.
import { typst } from 'codemirror-lang-typst'
import { $, esc, post, toast, download, settings, phone, P, rawUrl, saveAs } from './util.js'
import { files, comments } from './doc.js'
import { numbered } from './comments.js'
import { disk } from './tree.js'
import { applyLayout } from './menu.js'
import { typst as compilerOf, previewed } from './warm.js'

// The preview a member last saw, kept by the hub (early.js asks before the
// app loads; a link visitor's page asks now), and the key of what it shows:
// the sources, the pins and the files the document reads. While it is
// what this browser would compile, nothing is compiled or downloaded.
const cached = self.tydigPreview ?? (location.hash ? fetch(`/api${P('/preview')}`)
  .then(r => r.status === 200 ? r.text() : null).then(svg => svg && (show(svg), { key: /^<!--(\w+)-->/.exec(svg)?.[1] }))
  .catch(() => null) : Promise.resolve(null))
function show(svg) {
  const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  if (!$('page').querySelector('svg')) $('page').replaceChildren(img)
}
const hash = s => { // cyrb53: equality, not secrecy (crypto.subtle needs https)
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
  a = Math.imul(a ^ a >>> 16, 2246822507) ^ Math.imul(b ^ b >>> 13, 3266489909)
  b = Math.imul(b ^ b >>> 16, 2246822507) ^ Math.imul(a ^ a >>> 13, 3266489909)
  return (b >>> 0).toString(36) + (a >>> 0).toString(36)
}
const keyOf = main => hash(JSON.stringify([main, [...files].map(([p, t]) => [p, t.toString()]).sort(),
  disk.map(f => [f.path, f.size, f.mtime]).sort(), numbered().map(c => [c.file, c.from, c.n])]))
// what this browser compiled, back to the hub once it has been still a while
let sent = null, upload
const keep = (main, svg) => { clearTimeout(upload); upload = setTimeout(() => {
  const key = keyOf(main)
  if (key !== sent) fetch(`/api${P('/preview')}?key=${key}`, { method: 'PUT', body: svg,
    headers: { 'content-type': 'image/svg+xml' } }).then(r => r.ok && (sent = key), () => {})
}, 5000) }
// once the page is idle, the compiler loads anyway, so an edit has it at hand
// (and the preview's text can be selected); not if data is to be saved
const idle = () => navigator.connection?.saveData ||
  setTimeout(() => (self.requestIdleCallback || setTimeout)(() => scheduleCompile()), 3000)

// which file to compile: main.typ unless another is picked
export function renderMains() {
  const typs = [...files.keys()].filter(p => p.endsWith('.typ')).sort(), sel = $('main-sel'), prev = sel.value
  sel.replaceChildren(...typs.map(p => new Option(p)))
  sel.value = typs.includes(prev) ? prev : typs.includes('main.typ') ? 'main.typ' : typs[0] ?? ''
}
$('main-sel').onchange = () => scheduleCompile()
files.observe(renderMains)
files.observeDeep(() => scheduleCompile())
comments.observe(() => scheduleCompile())

// A comment's pin goes only where the grammar says the text is markup: in raw
// text it would show as code, in code, math, strings or comments break the
// compile. Those comments keep their pane entry and highlight, just no pin.
const parser = typst().language.parser, parses = new Map()
const UNSAFE = /^(Raw|Code|CodeBlock|Math|Equation|LineComment|BlockComment|Str|String|Label|Ref|Ident)$/
export function pinSafe(file, from) {
  const src = files.get(file)?.toString(), m = parses.get(file)
  if (src == null) return false
  const tree = m?.src === src ? m.tree : parser.parse(src)
  parses.set(file, { src, tree })
  for (let n = tree.resolveInner(from, from === 0 ? 1 : -1); n; n = n.parent) {
    if (n.name === 'Markup') return true
    if (UNSAFE.test(n.name)) return false
  }
  return false
}
const pin = n => '#box(width: 0pt, height: 0pt, place(dx: 1pt, dy: -10pt, circle(radius: 4pt, ' +
  `fill: rgb("#239dad"), stroke: none, inset: 0pt)[#align(center + horizon, text(white, 5.5pt)[${n}])]))`
const pinned = (file, src, cs) => cs.filter(c => c.file === file && pinSafe(file, c.from))
  .sort((a, b) => b.from - a.from).reduce((s, c) => s.slice(0, c.from) + pin(c.n) + s.slice(c.from), src)

const bins = new Map() // path -> its bytes, while its size and mtime stay
async function fetchBin(f) {
  const k = `${f.size}:${f.mtime}`, c = bins.get(f.path)
  if (c?.k === k) return c.bytes
  const r = await fetch(rawUrl(f.path))
  if (!r.ok) throw new Error(`${f.path}: ${r.status}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  bins.set(f.path, { k, bytes })
  return bytes
}
async function loadVfs(pins) {
  const cs = pins ? numbered() : [], $typst = await compilerOf()
  await $typst.resetShadow()
  for (const [p, t] of files)
    await $typst.addSource('/' + p, pins && p.endsWith('.typ') ? pinned(p, t.toString(), cs) : t.toString())
  const bin = disk.filter(f => !files.has(f.path) && !f.path.startsWith('out/') && f.size < 8e6)
  for (const [f, bytes] of await Promise.all(bin.map(async f => [f, await fetchBin(f)])))
    await $typst.mapShadow('/' + f.path, bytes)
}
// one virtual filesystem: a compile and a PDF export take turns
let vfs = Promise.resolve()
const serial = f => vfs = vfs.then(f, f)

// The compiler calls a file absent from its filesystem "access denied ...
// outside of project root". Say which file, and that a relative path starts
// from the file naming it: image("fig/a.svg") in lib/x.typ reads lib/fig/a.svg.
const normPath = p => p.split('/')
  .reduce((a, s) => s === '..' ? a.slice(0, -1) : s && s !== '.' ? [...a, s] : a, []).join('/')
const READS = /\b(?:image|json|csv|yaml|toml|xml|read|include|import)\(\s*"([^"@][^"]*)"\s*[,)]/g
function missing() {
  const here = new Set([...files.keys(), ...disk.map(f => f.path)]), out = new Map()
  for (const [p, t] of files) {
    if (!p.endsWith('.typ')) continue
    const dir = p.slice(0, p.lastIndexOf('/') + 1)
    // a whole literal path only: "/" + name is built at run time
    for (const [, ref] of t.toString().matchAll(READS)) {
      const abs = normPath(ref.startsWith('/') ? ref : dir + ref), r = normPath(ref)
      if (here.has(abs) || out.has(abs)) continue
      const fix = !ref.startsWith('/') && (here.has(r) ? r : [...here].find(q => q.endsWith('/' + r)))
      out.set(abs, `${p} reads "${ref}", which is ${abs}` +
        (fix ? `; from the project root, write "/${fix}"` : ''))
    }
  }
  return [...out]
}
function explain(e, at) {
  const raw = at || String(e?.message || e)
  if (!/access denied|outside of project root|not found/.test(raw)) return raw
  const gone = missing() // the compiler's own words first: a guess must never hide them
  return raw.split('\n')[0] + '\n\n' + (gone.length ? 'Missing:\n' + gone.map(([, why]) => '  ' + why).join('\n')
    : 'The document reads a file that does not exist in the project.') +
    (gone.some(([p]) => /^(build|figures|out)\//.test(p)) ? '\nFiles under build/, figures/ or out/ come from ' +
      'the build: open the build panel and run "all".' : '') +
    '\n\nA relative path starts from the file that names it, not from the document; ' +
    'a path starting with / starts at the project root.'
}

// the same failure as file:line:col, not a span number
const where = main => serial(async () => (await (await (await compilerOf()).getCompiler())
  .compile({ mainFilePath: '/' + main, diagnostics: 'unix' })).diagnostics?.map(d => d.replace(/^\//, '')).join('\n'))

// nothing until the document has synced and the disk's files are known (start)
let timer, busy = false, again = false, first = true, synced = false, live = false
export function scheduleCompile() { if (synced) clearTimeout(timer), timer = setTimeout(compile, first ? 0 : 300) }
export function start() { synced = true; scheduleCompile() }
async function compile() {
  const main = $('main-sel').value, svg = async () => (await compilerOf()).svg({ mainFilePath: '/' + main })
  if (!main) return
  if (busy) return again = true
  busy = true
  if (first && (await cached)?.key === keyOf(main)) { // the hub's is this: shown, and enough for now
    first = false; sent = keyOf(main); busy = false; return idle()
  }
  try { // with pins, or (should a pin break it) without
    $('page').innerHTML = await serial(async () => {
      try { await loadVfs(true); return await svg() } catch { await loadVfs(false); return await svg() }
    })
    // a link in the document leads to the web or within it, nowhere else
    for (const a of $('page').querySelectorAll('a')) for (const h of ['href', 'xlink:href']) {
      const v = a.getAttribute(h)?.trim(), web = () => /^https?:$/.test(new URL(v, 'https://x/').protocol)
      if (v && v[0] !== '#' && !(() => { try { return web() } catch { return false } })()) a.removeAttribute(h)
    }
    $('diag').hidden = true
    fitText(); keep(main, $('page').innerHTML)
  } catch (e) { $('diag').textContent = explain(e, await where(main).catch(() => '')); $('diag').hidden = false }
  first = false; live || previewed(); live = true // the optional waits for this
  busy = false
  if (again) { again = false; scheduleCompile() }
}

export async function exportPdf() { // never with pins
  const main = $('main-sel').value
  if (!main) return
  const pdf = await serial(async () => { await loadVfs(false); return (await compilerOf()).pdf({ mainFilePath: '/' + main }) })
  saveAs(pdf, main.replace(/\.typ$/, '.pdf'), 'application/pdf', false)
}

// Word, made by the hub (pandoc), its citations live fields for EndNote
export async function exportDocx() {
  const file = $('main-sel').value
  if (!file) return
  toast(`making ${esc(file.replace(/typ$/, 'docx'))}&hellip;`, true, 0)
  const r = await post(P('/docx'), { file })
  if (!r.ok) return toast(esc(r.output), false)
  toast('In Word, EndNote &gt; Update Citations and Bibliography makes them live', true, 8000)
  download(rawUrl(r.path), r.path)
}

// On a phone, fit means fit the text, not the paper: the side margins are cut
// away, so the words are as large as the screen allows.
export function fitText() {
  const pg = $('page'), svg = pg.querySelector('svg')
  pg.style.marginLeft = ''
  if (!svg || !phone() || settings.zoom || settings.m !== 'preview') return
  pg.style.width = '100%'
  const r = svg.getBoundingClientRect(), xs = [...svg.querySelectorAll('.typst-text, .typst-shape, image')]
    .map(e => e.getBoundingClientRect()).filter(b => b.width && b.width < r.width * 0.97)
  if (!xs.length) return
  const left = Math.min(...xs.map(b => b.left)) - r.left - 6
  const right = Math.max(...xs.map(b => b.right)) - r.left + 6
  const k = r.width / (right - left)
  pg.style.width = `${k * 100}%`; pg.style.marginLeft = `${-left * k}px`
}
addEventListener('resize', () => fitText())

// a zoom is a page width; none fits the pane
export function zoom(z) {
  settings.zoom = z === 'fit' ? null
    : Math.min(4, Math.max(0.25, $('page').offsetWidth / 820 * (z === '+' ? 1.15 : 1 / 1.15)))
  applyLayout()
}
$('zoomctl').onclick = e => e.target.dataset.z && zoom(e.target.dataset.z)
// Ctrl/Cmd + wheel over the preview zooms the page, not the whole app
$('preview').addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? '+' : '-') }
}, { passive: false })
