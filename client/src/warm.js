// First, before sign-in and the shared document: the preview's compiler and
// renderer download and compile, and its fonts download, all at once. What
// is optional (spelling, the language server, AI) waits for the first
// preview, or 8 s, so it never takes the bandwidth or the CPU from it.
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

const get = u => fetch(u).then(r => r.ok ? r : Promise.reject(new Error(`${u}: ${r.status}`)))
export const compiler = WebAssembly.compileStreaming(get(compilerWasm))
export const renderer = WebAssembly.compileStreaming(get(rendererWasm))
// fonts/ at the repo root, bundled: the build sandbox installs the same files,
// so the preview needs no network and sets type like the built PDF
export const fonts = Promise.all(Object.values(import.meta.glob('../../fonts/*.{otf,ttf}',
  { query: '?url', import: 'default', eager: true })).map(u => get(u).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))))
let shown
export const previewed = () => shown()
export const later = Promise.race([new Promise(r => shown = r), new Promise(r => setTimeout(r, 8000))])
