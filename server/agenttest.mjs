// Agent members: a token, @mentions as tasks, live edits merged with typing,
// answers in the Discussion, the MCP server, and the runner.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const B = 'http://localhost:3000', here = path.dirname(fileURLToPath(import.meta.url))
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (f, ms = 15000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(300)) if (await f()) return true; return false }
const signup = async email => (await fetch(`${B}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ email, password: 'password123', name: email.split('@')[0] }) })).headers.getSetCookie()[0].split(';')[0]
const as = (cookie, p, o = {}) => fetch(`${B}/api${p}`, { ...o, headers: { cookie, origin: B, 'content-type': 'application/json' } })
const agent = (token, method, p, body) => fetch(`${B}/api/agent/paper${p}`, { method, body: body && JSON.stringify(body),
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })

const ann = await signup('ann@example.com'), bob = await signup('bob@example.com')
await as(ann, '/projects/paper', { method: 'POST' }); await as(ann, '/projects/other', { method: 'POST' })
await as(ann, '/p/paper/members', { method: 'POST', body: JSON.stringify({ email: 'bob@example.com' }) })
check('a member cannot add an agent', (await as(bob, '/p/paper/agents', { method: 'POST', body: JSON.stringify({ name: 'claude' }) })).status === 403)
const { token } = await (await as(ann, '/p/paper/agents', { method: 'POST', body: JSON.stringify({ name: 'claude' }) })).json()
check('the owner adds one and gets its token once', /^tyd_/.test(token) && !JSON.stringify(await (await as(ann, '/p/paper/agents')).json()).includes(token))
check('a wrong token is refused', (await agent('tyd_nope', 'GET', '/tasks')).status === 401)
check('the token opens no other project', (await fetch(`${B}/api/agent/other/tasks`, { headers: { authorization: `Bearer ${token}` } })).status === 401)

// ann, in the editor: a comment and a Discussion message, both asking @claude
const tok = /session_token=([^;]+)/.exec(ann)[1], doc = new Y.Doc()
new HocuspocusProvider({ url: 'ws://localhost:1234', name: 'paper', document: doc, token: tok, WebSocketPolyfill: WebSocket })
await until(() => doc.getMap('files').has('main.typ'))
const main = doc.getMap('files').get('main.typ'), at = main.toString().indexOf('Pre-registration')
const rel = i => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(main, i))).toString('base64')
doc.getMap('comments').set('c1', { file: 'main.typ', author: 'ann', text: '@claude say this more plainly', ts: 1, anchor: rel(at), head: rel(at + 16) })
doc.getArray('chat').push([{ id: 'm1', author: 'ann', text: 'hello @Claude, add a line to notes.typ', ts: 2 }, { id: 'm2', author: 'ann', text: 'no mention', ts: 3 }])
await sleep(800)
const { tasks } = await (await agent(token, 'GET', '/tasks')).json()
check('both mentions are its tasks, and nothing else', tasks.map(t => t.id).sort().join() === 'c1,m1')
check('a comment task quotes the text it is on', tasks.find(t => t.id === 'c1')?.quote === 'Pre-registration')

// it reads, ann keeps typing, it writes: both survive, live
const { text } = await (await agent(token, 'GET', '/file?path=main.typ')).json()
main.insert(0, '// ann typing meanwhile\n')
await agent(token, 'PUT', '/file', { path: 'main.typ', base: text, text: text.replace('= Pre-registration', '= Pre-registration (plainly)') })
await sleep(500)
check('its edit reaches the editor live, and ann\'s typing is kept', main.toString().includes('(plainly)') && main.toString().startsWith('// ann typing meanwhile'))
check('it cannot write build outputs', (await agent(token, 'PUT', '/file', { path: 'out/x.pdf', text: 'x' })).status === 400)
await agent(token, 'POST', '/say', { answers: 'c1', text: 'Done: plainer heading.' })
await sleep(500)
const reply = doc.getArray('chat').toArray().find(m => m.answers === 'c1')
check('its answer is in the Discussion, threaded on the comment', reply?.author === 'claude' && reply.re === 'c1')
check('and that task is done', !(await (await agent(token, 'GET', '/tasks')).json()).tasks.some(t => t.id === 'c1'))

// the MCP server, as Claude Code would drive it
const mcp = spawn(process.execPath, [path.join(here, 'agent-mcp.mjs')], { env: { ...process.env, TYDIG_HUB: B, TYDIG_PROJECT: 'paper', TYDIG_AGENT_TOKEN: token } })
let out = ''; mcp.stdout.on('data', d => out += d)
for (const [id, method, params] of [[1, 'initialize', { protocolVersion: '2025-06-18' }], [2, 'tools/list'], [3, 'tools/call', { name: 'tydig_tasks', arguments: {} }]])
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
await until(() => out.split('\n').filter(Boolean).length >= 3, 8000); mcp.kill()
const [init, list, called] = out.split('\n').filter(Boolean).map(l => JSON.parse(l))
check('MCP: it introduces itself and lists its tools', init.result.serverInfo.name === 'tydig' && list.result.tools.length === 5)
check('MCP: a tool call returns the tasks', called.result.content[0].text.includes('m1'))

// the runner: an agent that does nothing gets the task closed with a note, not retried forever
const runner = spawn(process.execPath, [path.join(here, 'agent.mjs')], { env: { ...process.env, TYDIG_HUB: B, TYDIG_PROJECT: 'paper', TYDIG_AGENT_TOKEN: token, TYDIG_AGENT_CMD: 'test -n "$TYDIG_PROMPT" && test -f "$TYDIG_MCP"; exit 3' }, stdio: 'ignore' })
check('the runner hands each task to the agent, and says so when it fails', await until(() =>
  doc.getArray('chat').toArray().some(m => m.answers === 'm1' && /could not finish.*3/.test(m.text))))
runner.kill()

console.log(pass ? '\nAGENT ALL PASS' : '\nAGENT FAILURES')
process.exit(pass ? 0 : 1)
