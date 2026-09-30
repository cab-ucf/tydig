// Offline editing + reconnect merge (CRDT, conflict-free) + diff-review logic.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const O = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }

const su = await fetch(`${O}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: O },
  body: JSON.stringify({ email: `off${Date.now()}@t.co`, password: 'password123', name: 'Off' }),
})
const cookie = su.headers.getSetCookie()[0].split(';')[0]
const tok = /better-auth\.session_token=([^;]+)/.exec(cookie)[1]
const proj = 'offl' + Date.now().toString(36)
await fetch(`${O}/api/projects/${proj}`, { method: 'POST', headers: { cookie, origin: O } })

const mk = () => {
  const doc = new Y.Doc()
  const p = new HocuspocusProvider({ url: 'ws://localhost:1234', name: proj, document: doc, token: tok, WebSocketPolyfill: WebSocket })
  return { doc, p, f: doc.getMap('files') }
}
const A = mk(), B = mk()
await sleep(1500)

// both have the template
check('both clients synced template', A.f.has('main.typ') && B.f.has('main.typ'))

// A goes offline
A.p.disconnect()
await sleep(300)

// while A is offline: B edits main.typ, A edits main.typ locally (divergence)
B.f.get('main.typ').insert(0, 'BBB-remote\n')
A.f.get('main.typ').insert(0, 'AAA-local\n')
await sleep(500)
check('offline A did not see B edit yet', !A.f.get('main.typ').toString().includes('BBB-remote'))

// A reconnects -> CRDT merges both, nothing lost
A.p.connect()
await sleep(1500)
const merged = A.f.get('main.typ').toString()
check('after reconnect: A local edit survived', merged.includes('AAA-local'))
check('after reconnect: B remote edit merged in', merged.includes('BBB-remote'))
check('both clients converge', A.f.get('main.typ').toString() === B.f.get('main.typ').toString())

// Everyone leaves, the server unloads the doc; A keeps editing offline (its
// IndexedDB copy). The reloaded doc must be the same CRDT, not a re-seed with
// fresh types -- or A's edit loses the merge and silently vanishes.
const id = A.f.get('main.typ')._item.id
A.p.destroy(); B.p.destroy()
await sleep(3500)
A.f.get('main.typ').insert(0, 'AFTER-UNLOAD\n')
const C = mk(); await sleep(1500)
check('reloaded doc keeps its CRDT identity', C.f.get('main.typ')._item.id.client === id.client && C.f.get('main.typ')._item.id.clock === id.clock)
const A2 = new HocuspocusProvider({ url: 'ws://localhost:1234', name: proj, document: A.doc, token: tok, WebSocketPolyfill: WebSocket })
await sleep(1500)
check('offline edit made after unload survives reconnect', C.f.get('main.typ').toString().includes('AFTER-UNLOAD'))
A2.destroy(); C.p.destroy()

// review diff logic (same LCS as client)
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1])
  const ops = []; let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({t:'same',x:A[i]}); i++; j++ }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({t:'del',x:A[i]}); i++ }
    else { ops.push({t:'add',x:B[j]}); j++ }
  }
  while (i<n) ops.push({t:'del',x:A[i++]}); while (j<m) ops.push({t:'add',x:B[j++]})
  return ops
}
const d = lineDiff('line1\nline2\nline3', 'line1\nCHANGED\nline3')
check('diff detects 1 add + 1 del', d.filter(o=>o.t==='add').length===1 && d.filter(o=>o.t==='del').length===1)
check('diff keeps unchanged lines', d.filter(o=>o.t==='same').length===2)

console.log(pass ? '\nOFFLINE ALL PASS' : '\nOFFLINE FAILURES')
process.exit(pass ? 0 : 1)
