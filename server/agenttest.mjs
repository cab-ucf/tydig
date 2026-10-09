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

// the MCP server, as Claude Code would drive it, against stand-ins for
// Crossref, PubMed and OpenAlex
const work = { DOI: '10.1/a', type: 'journal-article', title: ['Cells sense crowding'], author: [{ family: 'Smith' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['Cell'] }
const fake = (await import('node:http')).createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), send = (b, type = 'application/json') => r.writeHead(200, { 'content-type': type }).end(typeof b === 'string' ? b : JSON.stringify(b))
  if (u.pathname.endsWith('/transform/application/x-bibtex')) return send('@article{X, title={Cells sense crowding}, author={Smith, Ann}, journal={Cell}, year={2020}, doi={10.1/a}}', 'text/plain')
  if (u.pathname.startsWith('/works/')) return decodeURIComponent(u.pathname.slice(7)) === '10.1/a' ? send({ message: work }) : r.writeHead(404).end()
  if (u.pathname === '/works') return send({ message: { items: [work, { DOI: '10.1/a.s001', type: 'component', title: ['Supplement'] }] } })
  if (u.pathname.endsWith('esearch.fcgi')) return send({ esearchresult: { idlist: ['111', '222'] } })
  if (u.pathname.endsWith('efetch.fcgi')) return send(['<PubmedArticleSet>', ...[['111', '10.1/a'], ['222', null]].map(([id, doi]) => `<PubmedArticle><PMID>${id}</PMID>
    <Journal><Title>Cell</Title><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal><ArticleTitle>Paper ${id} &amp; crowding</ArticleTitle>
    <AuthorList><Author><LastName>Smith</LastName></Author></AuthorList><Abstract><AbstractText>About <i>crowding</i>.</AbstractText></Abstract>
    ${doi ? `<ArticleIdList><ArticleId IdType="doi">${doi}</ArticleId></ArticleIdList>` : ''}</PubmedArticle>`), '</PubmedArticleSet>'].join(''), 'text/xml')
  if (u.pathname === '/oa') return send({ results: [{ title: 'Crowding, a contrary view', authorships: [{ author: { display_name: 'Bob Jones' } }], publication_year: 2023,
    doi: 'https://doi.org/10.1/b', cited_by_count: 4, abstract_inverted_index: { No: [0], effect: [1] } }] })
  r.writeHead(404).end()
}).listen(3999)
const mcp = spawn(process.execPath, [path.join(here, 'agent-mcp.mjs')], { env: { ...process.env, TYDIG_HUB: B, TYDIG_PROJECT: 'paper', TYDIG_AGENT_TOKEN: token,
  TYDIG_CROSSREF: 'http://localhost:3999/works', TYDIG_PUBMED: 'http://localhost:3999/eutils', TYDIG_OPENALEX: 'http://localhost:3999/oa', OPENALEX_API_KEY: 'k' } })
let out = '', n = 0; mcp.stdout.on('data', d => out += d)
const rpc = async (method, params) => {
  const id = ++n; mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  let m; await until(() => (m = out.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(x => x.id === id)), 8000); return m
}
const tool = async (name, args = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text) }
const init = await rpc('initialize', { protocolVersion: '2025-06-18' }), list = await rpc('tools/list')
check('MCP: it introduces itself and lists its tools', init.result.serverInfo.name === 'tydig' && list.result.tools.length === 9)
check('MCP: a tool call returns the tasks', JSON.stringify(await tool('tydig_tasks')).includes('m1'))
const found = await tool('tydig_search', { query: 'cells crowding' })
check('search: every index, one entry a paper (not a supplement), abstracts as text', found.papers.length === 3 && !found.failed.length &&
  found.papers.some(p => p.doi === '10.1/b' && p.abstract === 'No effect') && found.papers.some(p => p.pmid === '222' && p.title === 'Paper 222 & crowding'))
const c1 = await tool('tydig_cite', { doi: '10.1/a' }), c2 = await tool('tydig_cite', { doi: 'https://doi.org/10.1/a' })
check('cite: the registrar\'s own BibTeX into refs.bib, under a key it returns, and once', c1.key === 'smith2020cells' && c1.added && c2.key === c1.key && !c2.added &&
  /@article\{smith2020cells,[\s\S]*doi = \{10\.1\/a\}/.test((await (await agent(token, 'GET', '/file?path=refs.bib')).json()).text))
check('cite: a DOI that does not exist is refused, not invented', /404|exists/.test((await tool('tydig_cite', { doi: '10.1/nope' })).error || ''))
const bib = (await (await agent(token, 'GET', '/file?path=refs.bib')).json()).text
await agent(token, 'PUT', '/file', { path: 'refs.bib', base: bib, text: bib + '\n@article{wrong, title={Cells sense crowding}, author={Jones, Bob}, year={2021}, doi={10.1/a}}\n' })
const m0 = (await (await agent(token, 'GET', '/file?path=main.typ')).json()).text
await agent(token, 'PUT', '/file', { path: 'main.typ', base: m0, text: m0 + '\nCells sense crowding @smith2020cells. Others disagree @wrong; see @ghost2019.\n' })
const refs = await tool('tydig_check_refs')
const ref = k => refs.references.find(r => r.key === k)
check('check: each reference against its record, with the sentences citing it', ref('smith2020cells')?.status === 'ok' &&
  ref('smith2020cells').cited[0]?.sentence === 'Cells sense crowding @smith2020cells.' && ref('wrong')?.status === 'differs' && /authors: Smith/.test(ref('wrong').note))
check('check: a key cited but never added is named', refs.not_in_bibliography.join() === 'ghost2019')
const said = await tool('tydig_comment', { file: 'main.typ', quote: 'Others disagree', text: 'Jones 2023 (10.1/b) finds no effect.' })
await sleep(300)
const note = doc.getMap('comments').get(said.id)
check('comment: on the passage it quotes, by the agent, for everyone to see', note?.author === 'claude' && note.file === 'main.typ' &&
  main.toString().slice(Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(note.anchor, 'base64')), doc).index).startsWith('Others disagree'))
check('comment: a quote that is not in the file is refused', /not in main\.typ/.test((await tool('tydig_comment', { file: 'main.typ', quote: 'no such words', text: 'x' })).error || ''))
mcp.kill(); fake.close()

// the runner: an agent that does nothing gets the task closed with a note, not retried forever
const runner = spawn(process.execPath, [path.join(here, 'agent.mjs')], { env: { ...process.env, TYDIG_HUB: B, TYDIG_PROJECT: 'paper', TYDIG_AGENT_TOKEN: token, TYDIG_AGENT_CMD: 'test -n "$TYDIG_PROMPT" && test -f "$TYDIG_MCP"; exit 3' }, stdio: 'ignore' })
check('the runner hands each task to the agent, and says so when it fails', await until(() =>
  doc.getArray('chat').toArray().some(m => m.answers === 'm1' && /could not finish.*3/.test(m.text))))
runner.kill()

console.log(pass ? '\nAGENT ALL PASS' : '\nAGENT FAILURES')
process.exit(pass ? 0 : 1)
