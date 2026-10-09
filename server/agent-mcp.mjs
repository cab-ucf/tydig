// An MCP server (stdio) that lets Claude Code, or any MCP client, work on one
// tydig project as an agent member: read and edit its text live, see where
// it is @mentioned, answer in the Discussion, comment on passages, and find,
// cite and check papers (refs.mjs, the Cite panel's own code).
//   TYDIG_HUB=http://localhost:8080 TYDIG_PROJECT=paper TYDIG_AGENT_TOKEN=tyd_... node agent-mcp.mjs
// MCP over stdio is JSON-RPC, a message per line; only what tools need is here.
// OPENALEX_API_KEY (free, openalex.org) adds a third index to search.
import { SEARCH, byDoi, byPmid, parseBib, addTo, check } from './refs.mjs'
const { TYDIG_HUB: hub = 'http://localhost:8080', TYDIG_PROJECT: proj, TYDIG_AGENT_TOKEN: token } = process.env
const call = async (method, p, body) => {
  const r = await fetch(`${hub}/api/agent/${proj}${p}`, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j
}
const read = new Map() // path -> the text as read: the base a write is merged from
const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const tools = {
  tydig_tasks: { description: 'Where people @mentioned you and you have not yet answered: id, who, what they ask, and the file and quoted text a comment is on.',
    props: {}, run: () => call('GET', '/tasks') },
  tydig_files: { description: "The project's text files.", props: {}, run: () => call('GET', '/files') },
  tydig_read: { description: 'Read a text file, as it is now in everyone\'s editor.', props: { path: str('e.g. main.typ') },
    run: async ({ path }) => { const f = await call('GET', `/file?path=${encodeURIComponent(path)}`); read.set(path, f.text); return f.text } },
  tydig_write: { description: 'Replace a text file with your edited version. Read it first: your change is merged with what people typed since, live in their editors. A new path creates the file.',
    props: { path: str('the file'), text: str('its whole new content') },
    run: ({ path, text }) => call('PUT', '/file', { path, text, base: read.get(path) }).then(r => (read.set(path, text), r)) },
  tydig_reply: { description: 'Post in the Discussion. Set answers to the task id you are answering (it is then done, and the reply joins that comment\'s thread); leave it out to write to everyone.',
    props: { text: str('what you did, or a question'), answers: str('task id') }, required: ['text'],
    run: ({ text, answers }) => call('POST', '/say', { text, answers }) },
}
const text = p => call('GET', `/file?path=${encodeURIComponent(p)}`).then(f => f.text, () => '')
const bibPath = async () => { const fs = await call('GET', '/files'); return fs.includes('refs.bib') ? 'refs.bib' : fs.find(f => f.endsWith('.bib')) || 'refs.bib' }
const brief = p => ({ ...p, authors: p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' et al.' : ''), abstract: p.abstract?.slice(0, 700) })
// each sentence of the .typ files that cites key
const sentences = (texts, key) => texts.flatMap(([file, t]) => [...t.matchAll(new RegExp(`[^.!?\\n]*@${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.!?\\n]*[.!?]?`, 'g'))]
  .slice(0, 3).map(m => ({ file, sentence: m[0].trim() })))
Object.assign(tools, {
  tydig_search: { description: `Search for papers. Each index ranks and covers differently (${Object.keys(SEARCH).join(', ')}), so search a claim
several ways: in its own words, in technical or MeSH terms, as the opposite finding, as a review or meta-analysis. Returns title, authors, year,
venue, DOI or PMID, times cited and the abstract: judge from the abstract whether a paper says what a sentence claims.`,
    props: { query: str('words to search on'), source: str('one index (default: all)', { enum: Object.keys(SEARCH) }) }, required: ['query'],
    run: async ({ query, source }) => {
      const got = await Promise.allSettled((source ? [source] : Object.keys(SEARCH)).map(s => SEARCH[s](query)))
      const seen = new Set(), papers = got.flatMap(r => r.value || []).filter(p => { const k = (p.doi || p.pmid || p.title).toLowerCase(); return !seen.has(k) && seen.add(k) })
      return { papers: papers.map(brief), failed: got.map((r, i) => r.reason && `${(source ? [source] : Object.keys(SEARCH))[i]}: ${r.reason.message}`).filter(Boolean) }
    } },
  tydig_cite: { description: `Add a paper to the bibliography from its registrar's record (Crossref, by DOI; PubMed, by PMID), never typed out: it
returns the @key to put in the text (with tydig_write, after the claim, before its full stop). A paper already there keeps its key.`,
    props: { doi: str('e.g. 10.1038/nature17946'), pmid: str('when it has no DOI') }, required: [],
    run: async ({ doi, pmid }) => {
      const p = doi ? await byDoi(doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')) : pmid ? await byPmid(pmid) : null
      if (!p) throw new Error('give a DOI or PMID that exists (from tydig_search)')
      const path = await bibPath(), base = await text(path), r = await addTo(base, p)
      if (r.added) await call('PUT', '/file', { path, text: r.bib, base }), read.set(path, r.bib)
      return { key: r.key, added: !!r.added, title: p.title, bibliography: path }
    } },
  tydig_check_refs: { description: `Check every reference in the bibliography against its published record (Crossref): ok; differs (how); missing
(no such paper); web (a page, not checkable); error (could not check, which is not "missing"). With each, the sentences that cite it, to judge
whether the paper supports them, and any @key cited but not in the bibliography.`,
    props: {}, run: async () => {
      const path = await bibPath(), entries = parseBib(await text(path))
      const texts = await Promise.all((await call('GET', '/files')).filter(f => f.endsWith('.typ')).map(async f => [f, await text(f)]))
      // an @ that is not a reference: a label (<fig-x>, @fig-x), a package (@preview/...), an address
      const known = new Set([...entries.map(e => e.key), ...texts.flatMap(([, t]) => [...t.matchAll(/<([\w:.-]+)>/g)].map(m => m[1]))])
      return { bibliography: path, references: await Promise.all(entries.map(async e => {
        const r = await check(e).catch(err => ({ status: 'error', note: `could not reach Crossref: ${err.message}` }))
        return { key: e.key, title: e.fields.title, status: r.status, note: r.note, cited: sentences(texts, e.key) }
      })), not_in_bibliography: [...new Set(texts.flatMap(([, t]) => [...t.matchAll(/(?<![\w.])@([A-Za-z][\w:-]*\w)(?![\w/])/g)].map(m => m[1])))].filter(k => !known.has(k)) }
    } },
  tydig_comment: { description: `Comment on a passage, as a person does: on the exact text quoted, which must appear in the file. Raise there what
the collaborators should weigh: a paper that contradicts the claim, a stronger or newer source, a reference that does not match its record, a
claim that needs a citation. Name the papers (title, year, DOI). Comment; do not rewrite their text unless asked to.`,
    props: { file: str('e.g. main.typ'), quote: str('the passage, exactly as written'), text: str('your comment') },
    run: ({ file, quote, text }) => call('POST', '/comment', { file, quote, text }) },
})
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...result }) + '\n')
let buf = ''
process.stdin.on('data', async d => {
  buf += d; let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    const { id, method, params } = JSON.parse(line)
    if (id === undefined) continue // a notification
    if (method === 'initialize') reply(id, { result: { protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'tydig', version: '1' } } })
    else if (method === 'tools/list') reply(id, { result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description,
      inputSchema: { type: 'object', properties: t.props, required: t.required ?? Object.keys(t.props) } })) } })
    else if (method === 'tools/call') {
      const out = await Promise.resolve(tools[params.name]?.run(params.arguments || {}))
        .then(r => ({ text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }), e => ({ text: String(e.message || e), isError: true }))
      reply(id, { result: { content: [{ type: 'text', text: out.text }], isError: !!out.isError } })
    } else if (method === 'ping') reply(id, { result: {} })
    else reply(id, { error: { code: -32601, message: `no method ${method}` } })
  }
})
