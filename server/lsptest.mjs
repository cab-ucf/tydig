// LSP bridge: initialize handshake + completion through ws -> tinymist stdio
import WebSocket from 'ws'
const O = process.env.B || 'http://localhost:3000'
const su = await fetch(`${O}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: O },
  body: JSON.stringify({ email: `lsp${Date.now()}@t.co`, password: 'password123', name: 'Lsp' }),
})
const cookie = su.headers.getSetCookie()[0].split(';')[0]
const tok = /better-auth\.session_token=([^;]+)/.exec(cookie)[1]
await fetch(`${O}/api/projects/demo-lsp`, { method: 'POST', headers: { cookie, origin: O } })
const ws = new WebSocket(`${O.replace('http', 'ws')}/lsp?proj=demo-lsp&t=${encodeURIComponent(tok)}`, { headers: { origin: O } })
const send = (id, method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
const info = await fetch(`${O}/api/p/demo-lsp/info`, { headers: { cookie, origin: O } }).then(r => r.json())
const root = `file://${info.root}`
let initOk = false, complOk = false
ws.on('open', () => send(1, 'initialize', { processId: null, rootUri: root, capabilities: {}, workspaceFolders: [{ name: 'demo-lsp', uri: root }] }))
ws.on('message', m => {
  const msg = JSON.parse(m)
  if (msg.id === 1 && msg.result?.capabilities) {
    initOk = true
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }))
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: root + '/main.typ', languageId: 'typst', version: 1, text: '#fig' } } }))
    setTimeout(() => send(2, 'textDocument/completion', { textDocument: { uri: root + '/main.typ' }, position: { line: 0, character: 4 } }), 600)
  }
  if (msg.id === 2) {
    const items = msg.result?.items ?? msg.result ?? []
    complOk = items.some?.(i => /figure/.test(i.label))
    console.log(initOk ? 'PASS lsp initialize' : 'FAIL initialize')
    console.log(complOk ? 'PASS lsp completion (figure)' : 'FAIL completion: ' + JSON.stringify(items).slice(0, 120))
    process.exit(initOk && complOk ? 0 : 1)
  }
})
ws.on('close', (c, r) => { console.log('FAIL ws closed', c, String(r)); process.exit(1) })
setTimeout(() => { console.log('FAIL timeout'); process.exit(1) }, 30000)
