// The live preview: typst compiled in the browser as you type (in a worker,
// typst.worker.js, so typing never waits), with comment pins; which file is
// missing when one is; PDF and Word export; zoom and fit.
import { typst } from 'codemirror-lang-typst'
import { $, esc, post, toast, download, settings, phone, P, rawUrl, saveAs, link } from './util.js'
import { files, comments } from './doc.js'
import { numbered } from './comments.js'
import { disk } from './tree.js'
import { applyLayout } from './menu.js'
import { previewed } from './warm.js'

// The preview a member last saw, kept by the hub (early.js asks before the
// app loads; a link visitor's page asks now), and the key of what it shows:
// the sources, the pins and the files the document reads. While it is
// what this browser would compile, nothing is compiled or downloaded.
const cached = link ? fetch(`/api${P('/preview')}`)
  .then(r => r.status === 200 ? r.text() : null).then(svg => svg && (show(svg), { key: /^<!--(\w+)-->/.exec(svg)?.[1] }))
  .catch(() => null) : self.tydigPreview ?? Promise.resolve(null)
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
// the files on disk a compile reads: not build output, not the shared text
// the hub mirrors to disk, nothing too big to send
const read = () => disk.filter(f => !files.has(f.path) && !f.path.startsWith('out/') && f.size < 8e6)
const keyOf = main => hash(JSON.stringify([main, [...files].map(([p, t]) => [p, t.toString()]).sort(),
  read().map(f => [f.path, f.size, f.mtime]).sort(), numbered().map(c => [c.file, c.from, c.n])]))
// what this browser compiled, back to the hub once it has been still a while,
// under the key of what was compiled (a failed compile cancels it)
let sent = null, upload
const keep = key => { clearTimeout(upload); upload = key !== sent && setTimeout(async () => {
  const { svg } = await ask('last')
  svg && fetch(`/api${P('/preview')}?key=${key}`, { method: 'PUT', body: svg, headers: { 'content-type': 'image/svg+xml' } })
    .then(r => r.ok && (sent = key), () => {})
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

// The worker, made on the first ask (an edit, or an idle page); each ask
// answered in turn. The sources go with every ask; a binary (an image, data)
// only when it is new or changed: the worker keeps the rest, and drops what
// the disk no longer has. Fetched here, where a link visitor's fetch reaches the hub.
let worker, asks = 0
const waits = new Map(), sentBins = new Map() // path -> size:mtime the worker has
const answer = data => { waits.get(data.id)?.(data); waits.delete(data.id) }
const ask = (op, msg) => new Promise(ok => {
  worker ??= Object.assign(new Worker(new URL('./typst.worker.js', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }) => answer(data),
    onerror: () => { // it did not load (a hub updated under a long-open page): say so, and try again next time
      worker = null; sentBins.clear(); whole = false
      for (const id of [...waits.keys()]) answer({ id, error: 'the compiler did not load: reload the page' })
    } })
  waits.set(++asks, ok); worker.postMessage({ id: asks, op, ...msg })
})
// the sources, plain and with comment pins (only files a pin goes in differ)
const sources = () => {
  const cs = numbered(), plain = [...files].map(([p, t]) => [p, t.toString()])
  const pinnedIn = new Set(cs.filter(c => pinSafe(c.file, c.from)).map(c => c.file))
  return { plain, pins: pinnedIn.size ? plain.map(([p, s]) => [p, pinnedIn.has(p) ? pinned(p, s, cs) : s]) : null }
}
// the binaries the worker lacks; done() once it has them
async function binaries() {
  const bin = read(), fresh = bin.filter(f => sentBins.get(f.path) !== `${f.size}:${f.mtime}`)
  const binaries = await Promise.all(fresh.map(async f => {
    const r = await fetch(rawUrl(f.path))
    if (!r.ok) throw new Error(`${f.path}: ${r.status}`)
    return [f.path, new Uint8Array(await r.arrayBuffer())]
  }))
  const keep = bin.map(f => f.path)
  return { binaries, keep, done: () => {
    for (const f of fresh) sentBins.set(f.path, `${f.size}:${f.mtime}`)
    for (const p of sentBins.keys()) if (!keep.includes(p)) sentBins.delete(p)
  } }
}

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

// The new preview into the page, in the parts the worker sends (a head, then
// pages; null for one the page has). A page goes in a box of its own, so one
// off screen is neither styled, laid out nor painted. Only what changed is
// parsed (its links made safe) and matched to what is there: an edit mostly
// changes a line, so only that line costs.
const web = v => { try { return /^https?:$/.test(new URL(v, 'https://x/').protocol) } catch { return false } }
const parse = s => { // (an inert template: typst's SVG is HTML-parsed, as innerHTML would)
  const t = document.createElement('template'); t.innerHTML = s
  for (const a of t.content.querySelectorAll('a')) for (const h of ['href', 'xlink:href']) {
    const v = a.getAttribute(h)?.trim() // to the web or within the document, nowhere else
    if (v && v[0] !== '#' && !web(v)) a.removeAttribute(h)
  }
  return t.content.firstElementChild
}
const page = p => {
  const [, w, h] = /data-page-width="([\d.]+)" data-page-height="([\d.]+)"/.exec(p) || [, 1, 1]
  return parse(`<div class="pg" style="aspect-ratio: ${w} / ${h}"><svg class="typst-doc" ` +
    `viewBox="0 0 ${w} ${h}">${p.replace(/ transform="[^"]*"/, '')}</svg></div>`)
}
// a part of a page made to show what a new one does: a part with the same
// key (typst's hash of what it draws, data-tid, and where) stays; else its
// parts are matched in turn, so a typed letter swaps in a line, not a page.
// A glyph that only moved is moved, not made again.
const key = e => e.getAttribute('data-tid') && e.getAttribute('data-tid') + e.getAttribute('transform')
function sync(o, n) {
  if (key(n) ? key(o) === key(n) : o.isEqualNode(n)) return
  if (o.tagName !== n.tagName || !key(o) !== !key(n) || !key(n) && (o.childElementCount || n.childElementCount))
    return o.replaceWith(n)
  for (const a of [...o.attributes]) n.hasAttribute(a.name) || o.removeAttribute(a.name)
  for (const a of n.attributes) o.getAttribute(a.name) !== a.value && o.setAttribute(a.name, a.value)
  const ns = [...n.children], want = new Set(ns.map(key).filter(Boolean))
  const old = new Map([...o.children].map(c => [key(c), c]))
  ns.forEach((c, i) => {
    const k = key(c) && old.get(key(c)), at = o.children[i]
    if (k) { old.delete(key(c)); k === at || o.insertBefore(k, at ?? null) }
    else if (at && !want.has(key(at))) sync(at, c)
    else o.insertBefore(c, at ?? null)
  })
  for (const c of [...o.children].slice(ns.length)) c.remove()
}
let whole = false // whether the page has all the worker last sent
function patch([head, ...pages]) {
  const pg = $('page'), cur = pg.firstElementChild
  if (head != null) {
    const next = parse(head + '</svg>'), n = [...next.children]
    if (!(cur instanceof SVGSVGElement)) pg.replaceChildren(next)
    else n.forEach((x, i) => { // a new glyph joins the rest: what shows them is left be
      const c = cur.children[i]
      if (c?.isEqualNode(x)) return
      if (c?.matches('defs.glyph') && x.matches('defs.glyph'))
        return c.append(...[...x.children].filter(g => !document.getElementById(g.id)))
      c ? c.replaceWith(x) : cur.append(x)
    })
    if (cur instanceof SVGSVGElement) for (const c of [...cur.children].slice(n.length)) c.remove()
  }
  const gs = [...pg.children].slice(1)
  pages.forEach((p, i) => {
    if (p == null) return
    const b = page(p), at = gs[i]
    if (!at) pg.append(b)
    else if (at.getAttribute('style') !== b.getAttribute('style')) at.replaceWith(b)
    else sync(at.querySelector('.typst-page'), b.querySelector('.typst-page'))
  })
  for (const g of gs.slice(pages.length)) g.remove()
}

// Nothing until the document has synced and the disk's files are known
// (start). Then a compile follows an edit within a beat, and keeps following
// while one types (one at a time; the next waits for the last).
let timer, busy = false, again = false, first = true, synced = false, live = false
export function scheduleCompile() { if (synced && !timer) timer = setTimeout(compile, first ? 0 : 120) }
export function start() { synced = true; scheduleCompile() }
async function compile() {
  timer = null
  const main = $('main-sel').value
  if (!main) return
  if (busy) return again = true
  busy = true
  if (first && (await cached)?.key === keyOf(main)) { // the hub's is this: shown, and enough for now
    first = false; sent = keyOf(main); busy = false; return idle()
  }
  const key = keyOf(main)
  try { // with pins, or (should a pin break it) without
    const { plain, pins } = sources(), { done, ...bins } = await binaries()
    const r = await ask('svg', { main, sources: pins ?? plain, plain: pins && plain, ...bins, all: !whole })
    if (!r.error || r.diag != null) done()
    if (!r.parts) throw Object.assign(new Error(r.error), { diag: r.diag })
    whole = false; patch(r.parts); whole = true
    $('diag').hidden = true
    fitText(); keep(key)
  } catch (e) { clearTimeout(upload); $('diag').textContent = explain(e, e.diag); $('diag').hidden = false }
  first = false; live || previewed(); live = true // the optional waits for this
  busy = false
  if (again) { again = false; scheduleCompile() }
}

export async function exportPdf() { // never with pins
  const main = $('main-sel').value
  if (!main) return
  const { done, ...bins } = await binaries(), r = await ask('pdf', { main, sources: sources().plain, ...bins })
  r.error || done()
  r.pdf ? saveAs(r.pdf, main.replace(/\.typ$/, '.pdf'), 'application/pdf', false) : toast(esc(r.error), false)
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
  const pg = $('page')
  pg.style.marginLeft = ''
  if (!pg.querySelector('.pg') || !phone() || settings.zoom || settings.m !== 'preview') return
  pg.style.width = '100%'
  const r = pg.getBoundingClientRect(), xs = [...pg.querySelectorAll('.typst-text, .typst-shape, image')]
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
