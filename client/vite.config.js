import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// the hub serves this in development (TYDIG_DEV=1); base './' lets the same
// build run from a hub and from the static site
export default defineConfig({
  plugins: [wasm()],
  resolve: { alias: { '@brand': `${import.meta.dirname}/brands/${process.env.TYDIG_BRAND || 'tydig'}` } },
  base: './',
  build: { target: 'esnext' },
  worker: { format: 'es', plugins: () => [wasm()] }, // typst.worker.js
})
