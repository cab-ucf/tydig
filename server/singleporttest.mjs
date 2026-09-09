import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
const B = 'http://localhost:3000'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }

const r = await fetch(`${B}/api/auth/sign-up/email`, { method: 'POST',
  headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ email: `sp${Date.now()}@t.co`, password: 'password123', name: 'SP' }) })
const cookie = r.headers.getSetCookie()[0].split(';')[0]
const tok = /better-auth\.session_token=([^;]+)/.exec(cookie)[1]
const api = (p, o = {}) => fetch(B + '/api' + p, { ...o, headers: { ...o.headers, cookie, origin: B } }).then(r => r.json())
await api('/projects/sp', { method: 'POST' })

// sync over the MAIN port at /sync (no :1234)
const doc = new Y.Doc()
let failed = false
new HocuspocusProvider({ url: 'ws://localhost:3000/sync', name: 'sp', document: doc,
  token: tok, WebSocketPolyfill: WebSocket, onAuthenticationFailed: () => { failed = true } })
await sleep(2000)
check('sync works on the main port at /sync', !failed && doc.getMap('files').has('main.typ'))

// static client served from the same origin
const idx = await fetch(B + '/')
const html = await idx.text()
check('built client served at /', idx.status === 200 && html.includes('<div id="app"') || html.includes('<!doctype html'))
const spa = await fetch(B + '/some/deep/route')
check('SPA fallback serves index.html', spa.status === 200)
const api404 = await fetch(B + '/api/nope')
check('/api not swallowed by the SPA fallback', api404.status >= 400 && !(await api404.text()).includes('<!doctype'))

// unauth sync on the main port still rejected
const d2 = new Y.Doc(); let f2 = false
new HocuspocusProvider({ url: 'ws://localhost:3000/sync', name: 'sp', document: d2,
  token: 'bogus', WebSocketPolyfill: WebSocket, onAuthenticationFailed: () => { f2 = true } })
await sleep(1500)
check('unauthenticated /sync rejected', f2 && d2.getMap('files').size === 0)

console.log(pass ? '\nSINGLE-PORT ALL PASS' : '\nFAILURES')
process.exit(pass ? 0 : 1)
