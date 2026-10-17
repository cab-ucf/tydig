// The compiler, off the page's thread, so typing never waits on it. The page
// sends the sources and each binary once; it asks for the preview (svg, with
// comment pins, or without them should a pin break it; what changed of it),
// the diagnostics, or a PDF. The compiler, renderer and fonts load on the first ask (preview.js
// makes the worker then). One ask at a time: they share one virtual filesystem.
import { $typst } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'
import { loadFonts } from '@myriaddreamin/typst.ts/dist/esm/options.init.mjs'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

const get = u => fetch(u).then(r => r.ok ? r : Promise.reject(new Error(`${u}: ${r.status}`)))
// all at once: the compiler and renderer compile as they download
const compiler = WebAssembly.compileStreaming(get(compilerWasm))
const renderer = WebAssembly.compileStreaming(get(rendererWasm))
// fonts/ at the repo root, bundled: the build sandbox installs the same files,
// so the preview needs no network and sets type like the built PDF
const fonts = Promise.all(Object.values(import.meta.glob('../../fonts/*.{otf,ttf}',
  { query: '?url', import: 'default', eager: true })).map(u => get(u).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))))
$typst.setCompilerInitOptions({ getModule: () => compiler, beforeBuild: [Object.assign(async (...a) =>
  loadFonts(await fonts, { assets: false })(...a), // marked as a font loader, or typst.ts adds a CDN's
{ _kind: 'fontLoader', _preloadRemoteFontOptions: { assets: false } })] })
$typst.setRendererInitOptions({ getModule: () => renderer })

const bins = new Map() // path -> bytes, as the page last sent them
async function load(sources, binaries = [], keep) {
  for (const [p, b] of binaries) bins.set(p, b)
  if (keep) for (const p of bins.keys()) if (!keep.includes(p)) bins.delete(p)
  await $typst.resetShadow()
  for (const [p, s] of sources) await $typst.addSource('/' + p, s)
  for (const [p, b] of bins) await $typst.mapShadow('/' + p, b)
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
const ops = {
  async svg({ main, sources, plain, binaries, keep, all }) {
    await load(sources, binaries, keep)
    try { return parts(await $typst.svg({ mainFilePath: '/' + main }), all) } catch (e) {
      if (plain) { await load(plain); try { return parts(await $typst.svg({ mainFilePath: '/' + main }), all) } catch {} }
      return { error: String(e?.message || e), diag: await diagnose(main).catch(() => '') }
    }
  },
  last: () => ({ svg: whole }), // the whole, for the hub to keep
  async pdf({ main, sources, binaries, keep }) {
    await load(sources, binaries, keep)
    return { pdf: await $typst.pdf({ mainFilePath: '/' + main }) }
  },
}
let queue = Promise.resolve()
onmessage = ({ data }) => queue = queue.then(() => ops[data.op](data))
  .catch(e => ({ error: String(e?.message || e) })).then(r => postMessage({ id: data.id, ...r }))
