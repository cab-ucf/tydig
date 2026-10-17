import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// fonts/ (the build sandbox sets type in the same) for the preview, each with
// its info, measured here by the compiler itself: a face is fetched only once
// a document sets type in it (typst.worker.js)
const fonts = {
  name: 'fonts', resolveId: id => id === 'virtual:fonts' ? '\0fonts' : null,
  async load(id) {
    if (id !== '\0fonts') return
    const c = await import('@myriaddreamin/typst-ts-web-compiler'), dir = `${import.meta.dirname}/../fonts/`
    c.initSync({ module: readFileSync(fileURLToPath(import.meta.resolve('@myriaddreamin/typst-ts-web-compiler/wasm'))) })
    const fs = readdirSync(dir).filter(f => /\.(otf|ttf)$/.test(f))
    return fs.map((f, i) => `import u${i} from ${JSON.stringify(dir + f + '?url')}`).join('\n') + '\nexport default [' +
      fs.map((f, i) => `{ ...${JSON.stringify(c.get_font_info(readFileSync(dir + f)))}, url: u${i} }`) + ']'
  },
}

// the hub serves this in development (TYDIG_DEV=1); base './' lets the same
// build run from a hub and from the static site
export default defineConfig({
  plugins: [wasm()],
  resolve: { alias: { '@brand': `${import.meta.dirname}/brands/${process.env.TYDIG_BRAND || 'tydig'}` } },
  base: './',
  build: { target: 'esnext' },
  worker: { format: 'es', plugins: () => [wasm(), fonts] }, // typst.worker.js
})
