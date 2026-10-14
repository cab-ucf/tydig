// Agent members: a token for one project, MCP over HTTP at the hub,
// @mentions as tasks, live edits merged with typing, answers, comments,
// papers (against stand-ins for Crossref, PubMed and OpenAlex), the runner.
// The hub runs with TYDIG_CROSSREF/PUBMED/OPENALEX at :3999 (run.mjs).
import { spawn } from 'node:child_process'
import http from 'node:http'
import { HUB, Y, person, check, done, sleep, until } from './lib.mjs'

const ann = await person('Ann'), bob = await person('Bob')
await ann.post('/projects/paper'); await ann.post('/projects/other')
await ann.post('/p/paper/members', { email: bob.email })
check('a member cannot add an agent', (await bob.post('/p/paper/agents', { name: 'claude' })).error)
const { token } = await ann.post('/p/paper/agents', { name: 'claude' })
check('the owner adds one and sees its token once', /^tyd_/.test(token) && !JSON.stringify(await ann.get('/p/paper/agents')).includes(token))

let n = 0
const rpc = (method, params, t = token, p = 'paper') => fetch(`${HUB}/api/agent/${p}/mcp`, { method: 'POST',
  headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) })
const tool = async (name, args = {}) => {
  const r = (await (await rpc('tools/call', { name, arguments: args })).json()).result
  if (r.isError) return { error: r.content[0].text }
  try { return JSON.parse(r.content[0].text) } catch { return r.content[0].text }
}
check('a wrong token is refused', (await rpc('ping', {}, 'tyd_nope')).status === 401)
check('the token opens no other project', (await rpc('ping', {}, token, 'other')).status === 401)
const init = await (await rpc('initialize', { protocolVersion: '2025-06-18' })).json()
check('MCP: it introduces itself and lists its tools', init.result.serverInfo.name === 'tydig' &&
  (await (await rpc('tools/list')).json()).result.tools.length === 9)

// ann, in the editor: a comment and a Discussion message, both asking @claude
const doc = ann.doc('paper')
await until(async () => doc.files.has('main.typ'))
const main = doc.files.get('main.typ'), at = main.toString().indexOf('Pre-registration')
const rel = i => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(main, i))).toString('base64')
doc.getMap('comments').set('c1', { file: 'main.typ', author: 'ann', text: '@claude say this more plainly', ts: 1, anchor: rel(at), head: rel(at + 16) })
doc.getArray('chat').push([{ id: 'm1', author: 'ann', text: 'hello @Claude, add a line to notes.typ', ts: 2 }, { id: 'm2', author: 'ann', text: 'no mention', ts: 3 }])
await sleep(800)
const tasks = await tool('tydig_tasks')
check('both mentions are its tasks, and nothing else', tasks.map(t => t.id).sort().join() === 'c1,m1')
check('a comment task quotes the text it is on', tasks.find(t => t.id === 'c1')?.quote === 'Pre-registration')

// it reads, ann keeps typing, it writes: both survive, live
const text = await tool('tydig_read', { path: 'main.typ' })
main.insert(0, '// ann typing meanwhile\n')
await tool('tydig_write', { path: 'main.typ', text: text.replace('= Pre-registration', '= Pre-registration (plainly)') })
await sleep(500)
check('its edit reaches the editor live, and ann\'s typing is kept', main.toString().includes('(plainly)') && main.toString().startsWith('// ann typing meanwhile'))
check('it cannot write build outputs', (await tool('tydig_write', { path: 'out/x.pdf', text: 'x' })).error)
await tool('tydig_reply', { answers: 'c1', text: 'Done: plainer heading.' })
await sleep(500)
const reply = doc.getArray('chat').toArray().find(m => m.answers === 'c1')
check('its answer is in the Discussion, threaded on the comment', reply?.author === 'claude' && reply.re === 'c1')
check('and that task is done', !(await tool('tydig_tasks')).some(t => t.id === 'c1'))

const work = { DOI: '10.1/a', type: 'journal-article', title: ['Cells sense crowding'], author: [{ family: 'Smith' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['Cell'] }
const fake = http.createServer((q, r) => {
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

const found = await tool('tydig_search', { query: 'cells crowding' })
check('search: every index, a paper per entry (not a supplement), abstracts as text', found.papers.length === 3 && !found.failed.length &&
  found.papers.some(p => p.doi === '10.1/b' && p.abstract === 'No effect') && found.papers.some(p => p.pmid === '222' && p.title === 'Paper 222 & crowding'))
const c1 = await tool('tydig_cite', { doi: '10.1/a' }), c2 = await tool('tydig_cite', { doi: 'https://doi.org/10.1/a' })
check('cite: the registrar\'s own BibTeX into refs.bib, under a key it returns, and once', c1.key === 'smith2020cells' && c1.added && c2.key === c1.key && !c2.added &&
  /@article\{smith2020cells,[\s\S]*doi = \{10\.1\/a\}/.test(await tool('tydig_read', { path: 'refs.bib' })))
check('cite: a DOI that does not exist is refused, not invented', /404|exists/.test((await tool('tydig_cite', { doi: '10.1/nope' })).error || ''))
const bib = await tool('tydig_read', { path: 'refs.bib' })
await tool('tydig_write', { path: 'refs.bib', text: bib + '\n@article{wrong, title={Cells sense crowding}, author={Jones, Bob}, year={2021}, doi={10.1/a}}\n' })
const m0 = await tool('tydig_read', { path: 'main.typ' })
await tool('tydig_write', { path: 'main.typ', text: m0 + '\nCells sense crowding @smith2020cells. Others disagree @wrong; see @ghost2019.\n' })
const refs = await tool('tydig_check_refs'), ref = k => refs.references.find(r => r.key === k)
check('check: each reference against its record, with the sentences citing it', ref('smith2020cells')?.status === 'ok' &&
  ref('smith2020cells').cited[0]?.sentence === 'Cells sense crowding @smith2020cells.' && ref('wrong')?.status === 'differs' && /authors: Smith/.test(ref('wrong').note))
check('check: a key cited but never added is named', refs.not_in_bibliography.join() === 'ghost2019')
await tool('tydig_comment', { file: 'main.typ', quote: 'Others disagree', text: 'Jones 2023 (10.1/b) finds no effect.' })
await sleep(300)
const note = [...doc.getMap('comments').values()].find(c => c.author === 'claude')
check('comment: on the passage it quotes, by the agent, for everyone to see', note?.file === 'main.typ' &&
  main.toString().slice(Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(note.anchor, 'base64')), doc).index).startsWith('Others disagree'))
check('comment: a quote that is not in the file is refused', /not in main\.typ/.test((await tool('tydig_comment', { file: 'main.typ', quote: 'no such words', text: 'x' })).error || ''))
fake.close()

// the runner: an agent that does nothing gets the task closed with a note
const runner = spawn(process.execPath, [new URL('../server/agent.mjs', import.meta.url).pathname], { stdio: 'ignore', env: { ...process.env,
  TYDIG_HUB: HUB, TYDIG_PROJECT: 'paper', TYDIG_AGENT_TOKEN: token, TYDIG_AGENT_CMD: 'test -n "$TYDIG_PROMPT" && test -f "$TYDIG_MCP"; exit 3' } })
check('the runner hands each task to the agent, and says so when it fails', await until(async () =>
  doc.getArray('chat').toArray().some(m => m.answers === 'm1' && /could not finish.*3/.test(m.text))))
runner.kill()
done()
