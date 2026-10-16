// The preview's compiler and renderer (compiled as they download) and its
// fonts, all at once, when first wanted: an edit, or an idle page after the
// first view. What is optional (spelling, the language server, AI) waits for
// that first view, or 8 s, so it never takes the bandwidth or the CPU from it.
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

const get = u => fetch(u).then(r => r.ok ? r : Promise.reject(new Error(`${u}: ${r.status}`)))
const once = f => { let p; return () => p ??= f() }
export const compiler = once(() => WebAssembly.compileStreaming(get(compilerWasm)))
export const renderer = once(() => WebAssembly.compileStreaming(get(rendererWasm)))
// fonts/ at the repo root, bundled: the build sandbox installs the same files,
// so the preview needs no network and sets type like the built PDF
export const fonts = once(() => Promise.all(Object.values(import.meta.glob('../../fonts/*.{otf,ttf}',
  { query: '?url', import: 'default', eager: true })).map(u => get(u).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)))))
// typst.ts itself, made to take these
export const typst = once(async () => {
  compiler(); renderer(); fonts() // all at once
  const [{ $typst }, { loadFonts }] = await Promise.all([import('@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'),
    import('@myriaddreamin/typst.ts/dist/esm/options.init.mjs')])
  $typst.setCompilerInitOptions({ getModule: compiler, beforeBuild: [Object.assign(async (...a) =>
    loadFonts(await fonts(), { assets: false })(...a), // marked as a font loader, or typst.ts adds a CDN's
  { _kind: 'fontLoader', _preloadRemoteFontOptions: { assets: false } })] })
  $typst.setRendererInitOptions({ getModule: renderer })
  return $typst
})
let shown
export const previewed = () => shown()
export const later = Promise.race([new Promise(r => shown = r), new Promise(r => setTimeout(r, 15000))])
