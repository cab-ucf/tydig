// The compiler, off the page's thread, so typing never waits on it. The page
// sends what changed of its files since it last asked; it asks for the preview (svg, with
// comment pins, or without them should a pin break it; what changed of it),
// the diagnostics, a PDF, or the text it typesets. The compiler, renderer and fonts load on the first ask (preview.js
// makes the worker then). One ask at a time: they share one virtual filesystem.
import { TypstSnippet } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'
import { loadFonts } from '@myriaddreamin/typst.ts/dist/esm/options.init.mjs'
import { MemoryAccessModel } from '@myriaddreamin/typst.ts/dist/esm/fs/memory.mjs'
import fonts from 'virtual:fonts'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

const get = u => fetch(u).then(r => r.ok ? r : Promise.reject(new Error(`${u}: ${r.status}`)))
// all at once: the compiler and renderer compile as they download
const compiler = WebAssembly.compileStreaming(get(compilerWasm))
const renderer = WebAssembly.compileStreaming(get(rendererWasm))
// fonts/ at the repo root, as the build sandbox has them, so the preview sets
// type like the built PDF; each is fetched (from this hub) the first time a
// document uses it (vite.config.js). assets: false, or typst.ts adds a CDN's.
// Typst Universe packages come from the page, which has them from the hub: one
// the compiler wants and lacks fails the compile, and is asked for (need). A
// compiler asks for each once in its life, so new ones come with a new one.
const am = new MemoryAccessModel(), tars = new Map(), want = new Set() // name-version -> .tar.gz, or true: unpacked
const registry = { resolve({ namespace, name, version }, ctx) {
  const k = `${name}-${version}`, dir = `/@memory/packages/${k}`, t = tars.get(k)
  if (namespace !== 'preview') return
  if (!t) return void want.add(k)
  if (t !== true) ctx.untar(t, (p, d, m) => am.insertFile(`${dir}/${p.replace(/^\.\//, '')}`, d, new Date(m))), tars.set(k, true)
  return dir
} }
const make = () => {
  const t = new TypstSnippet() // with this registry, not typst.ts's own (to packages.typst.org)
  t.use(TypstSnippet.withAccessModel(am), TypstSnippet.withPackageRegistry(registry))
  t.setCompilerInitOptions({ getModule: () => compiler, beforeBuild: [loadFonts(fonts, { assets: false })] })
  t.setRendererInitOptions({ getModule: () => renderer })
  return t
}
let $typst = make()

// the page's files, as it changed them since the last ask (reset: from none;
// new packages come with a reset, as they come with a new compiler)
async function load({ reset, put = [], binaries = [], drop = [], packages = [] }) {
  if (packages.some(([k]) => !tars.has(k))) $typst = make()
  for (const [k, b] of packages) tars.has(k) || tars.set(k, b)
  want.clear()
  if (reset) await $typst.resetShadow()
  for (const p of drop) await $typst.unmapShadow('/' + p)
  for (const [p, s] of put) await $typst.addSource('/' + p, s)
  for (const [p, b] of binaries) await $typst.mapShadow('/' + p, b)
}
// the failure as file:line:col, not a span number
const diagnose = async main => (await (await $typst.getCompiler()).compile({ mainFilePath: '/' + main,
  diagnostics: 'unix' })).diagnostics?.map(d => d.replace(/^\//, '')).join('\n')

// The preview in parts: typst.ts's SVG is a head (styles, glyphs), a <g> per
// page, then a script (dropped: the page runs none). A part goes to the page
// only when it changed (null: it has it), unless the page asks for all.
const PAGE = '<g class="typst-page"', cut = (s, t) => { const i = s.lastIndexOf(t); return i < 0 ? s : s.slice(0, i) }
let shown = [], whole = ''
const parts = (svg, all) => {
  const ps = cut(cut(svg, '</svg>'), '<script').split(PAGE).map((p, i) => i ? PAGE + p : p)
  const out = ps.map((p, i) => all || p !== shown[i] ? p : null)
  shown = ps; whole = svg
  return { parts: out }
}
// What a reader reads: typst.ts's SVG carries each run of text for selecting
// (.tsel), in reading order, and the break that ends a line (a content hint:
// a space, or a newline closing a paragraph). A run in a new frame (a
// heading, a running head) starts a line; one after a soft hyphen goes on.
const RUN = /class="tsel"[^>]*>([^<]*)|data-hint="(\w+)"|(typst-group)/g
const XML = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = s => s.replace(/&(#x?)?(\w+);/g, (_, n, v) => n ? String.fromCodePoint(parseInt(v, n[1] ? 16 : 10)) : XML[v])
const reads = svg => {
  let out = '', frame = false
  for (const [, t, h] of svg.matchAll(RUN)) {
    if (t == null && !h) { frame = true; continue }
    if (frame && /[^\s\u00ad]$/.test(out)) out += '\n'
    out += h ? String.fromCodePoint(parseInt(h, 16)) : unxml(t); frame = false
  }
  return out.replace(/\u00ad/g, '').replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim()
}
const ops = {
  async svg(m) { // plain: the pinned files without pins, should a pin break the compile
    await load(m)
    const go = async () => parts(await $typst.svg({ mainFilePath: '/' + m.main }), m.all)
    try { return await go() } catch (e) {
      if (want.size) return lacking()
      if (m.plain) { await load({ put: m.plain }); try { return { ...await go(), plain: true } } catch {} }
      return { error: String(e?.message || e), diag: await diagnose(m.main).catch(() => ''), plain: !!m.plain }
    }
  },
  last: () => ({ svg: whole }), // the whole, for the hub to keep
  async text(m) { // the document as typeset, apart from the preview's parts
    await load(m)
    return { text: reads(await $typst.svg({ mainFilePath: '/' + m.main })) }
  },
  async pdf(m) {
    await load(m)
    try { return { pdf: await $typst.pdf({ mainFilePath: '/' + m.main }) } } catch (e) { if (want.size) return lacking(); throw e }
  },
}
const lacking = () => ({ error: `packages to fetch: ${[...want].join(', ')}`, diag: '', need: [...want] })
let queue = Promise.resolve()
onmessage = ({ data }) => queue = queue.then(() => ops[data.op](data))
  .catch(e => ({ error: String(e?.message || e) })).then(r => postMessage({ id: data.id, ...r }))
