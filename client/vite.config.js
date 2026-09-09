import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// Dev proxy makes everything same-origin (so the session cookie is sent on
// all requests, including websockets). In production, put one reverse proxy
// in front of the static client, :3000 (REST+auth+LSP), and :1234 (sync).
export default defineConfig({
  plugins: [wasm()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/lsp': { target: 'ws://localhost:3000', ws: true },
      '/sync': { target: 'ws://localhost:1234', ws: true, rewrite: p => p.replace(/^\/sync/, '') },
    },
  },
  build: { target: 'esnext' },
})
