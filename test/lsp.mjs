// The LSP bridge: initialize, then a completion, through ws -> tinymist
import WebSocket from 'ws'
import { HUB, person, check, done } from './lib.mjs'

const me = await person('Lsp')
await me.post('/projects/demo-lsp')
const root = `file://${(await me.get('/p/demo-lsp/info')).root}`
const ws = new WebSocket(`${HUB.replace('http', 'ws')}/lsp?proj=demo-lsp`, { headers: { origin: HUB, cookie: me.cookie } })
const send = (id, method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
const note = (method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
setTimeout(() => { check('answered in time', false); done() }, 30000)
ws.on('open', () => send(1, 'initialize', { processId: null, rootUri: root, capabilities: {} }))
ws.on('message', m => {
  const msg = JSON.parse(m)
  if (msg.id === 1) {
    check('lsp initialize', msg.result?.capabilities)
    note('initialized', {})
    note('textDocument/didOpen', { textDocument: { uri: root + '/main.typ', languageId: 'typst', version: 1, text: '#fig' } })
    setTimeout(() => send(2, 'textDocument/completion', { textDocument: { uri: root + '/main.typ' }, position: { line: 0, character: 4 } }), 600)
  }
  if (msg.id === 2) {
    check('lsp completion (figure)', (msg.result?.items ?? msg.result ?? []).some?.(i => /figure/.test(i.label)))
    done()
  }
})
