// Agent members: programs with a token for one project. The hub serves them
// MCP (streamable HTTP, JSON responses) at /api/agent/<project>/mcp:
//   claude mcp add --transport http tydig <hub>/api/agent/<project>/mcp \
//     --header "Authorization: Bearer tyd_..."
// They read and edit text live, see where they are @mentioned, answer,
// comment, and find, cite and check papers. Nothing else.
import express from 'express'
import * as Y from 'yjs'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HUB, hubFile, isProj, live, editable, mergeInto } from './store.mjs'
import { admin } from './auth.mjs'
import { FILE as TAGFILE, tagsOf } from './tags.mjs'
import { SEARCH, byDoi, byPmid, parseBib, addTo, check } from './refs.mjs'

// tokens: the hub keeps their hashes (DATA/.hub/<project>/agents.json)
const file = n => hubFile(n, 'agents.json')
const agentsOf = n => existsSync(file(n)) ? JSON.parse(readFileSync(file(n), 'utf8')) : []
const save = (n, a) => {
  mkdirSync(path.join(HUB, n), { recursive: true })
  writeFileSync(file(n), JSON.stringify(a), { mode: 0o600 })
}
const hash = t => createHash('sha256').update(String(t)).digest('hex')

export const router = express.Router({ mergeParams: true })
router.get('/agents', (req, res) =>
  res.json(agentsOf(req.params.proj).map(({ name, created }) => ({ name, created }))))
router.post('/agents', admin, (req, res) => {
  const n = req.params.proj, list = agentsOf(n), name = String(req.body?.name || '').trim().toLowerCase()
  if (!/^[a-z][\w-]{0,31}$/.test(name) || list.some(a => a.name === name))
    return res.status(400).json({ error: 'a new name: letters, digits, - or _' })
  const token = `tyd_${randomBytes(24).toString('base64url')}`
  save(n, [...list, { name, hash: hash(token), created: new Date().toISOString() }])
  res.json({ name, token }) // shown once
})
router.delete('/agents/:name', admin, (req, res) => {
  save(req.params.proj, agentsOf(req.params.proj).filter(a => a.name !== req.params.name))
  res.json({ ok: true })
})

// ---- the tools; each runs on the live document ----
const id = () => randomBytes(8).toString('hex'), COLOR = 'hsl(280 70% 55%)'
const textAt = (doc, p) => doc.getMap('files').get(p)?.toString()
const bibOf = doc => {
  const fs = [...doc.getMap('files').keys()]
  return fs.includes('refs.bib') ? 'refs.bib' : fs.find(f => f.endsWith('.bib')) || 'refs.bib'
}
const pos = (doc, s) => Y.createAbsolutePositionFromRelativePosition(
  Y.decodeRelativePosition(Buffer.from(s, 'base64')), doc)?.index
const relPos = (t, i, assoc) =>
  Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, i, assoc))).toString('base64')
const quoteOf = (doc, c) => {
  const a = pos(doc, c.anchor), b = pos(doc, c.head)
  return a != null && b != null ? textAt(doc, c.file)?.slice(a, b) : null
}
const brief = p => ({ ...p, abstract: p.abstract?.slice(0, 700),
  authors: p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' et al.' : '') })
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const reads = new Map() // agent|project|path -> text as read: the base a write merges from
const str = (description, more) => ({ type: 'string', description, ...more })

const TOOLS = {
  tydig_tasks: {
    about: 'Where people @mentioned you and you have not answered: id, who, what, ' +
      'and the file and quoted text of a comment.',
    run: ({}, { me, doc }) => {
      const at = new RegExp(`@${me}\\b`, 'i'), chat = doc.getArray('chat').toArray()
      const cs = doc.getMap('comments'), done = new Set(chat.filter(m => m.agent === me).map(m => m.answers))
      const on = c => c && { file: c.file, quote: quoteOf(doc, c), comment: c.text }
      return [
        ...[...cs].filter(([k, c]) => at.test(c.text) && !done.has(k))
          .map(([k, c]) => ({ id: k, from: c.author, text: c.text, ...on(c) })),
        // not from irch: anyone in a linked space could direct the project's agents
        ...chat.filter(m => !m.agent && !m.irch && at.test(m.text) && !done.has(m.id))
          .map(m => ({ id: m.id, from: m.author, text: m.text, ...on(m.re && cs.get(m.re)) })),
      ]
    },
  },
  tydig_files: {
    about: "The project's text files.",
    run: ({}, { doc }) => [...doc.getMap('files').keys()].sort(),
  },
  tydig_read: {
    about: "A text file as it is now in everyone's editor.",
    args: { path: str('e.g. main.typ') },
    run: ({ path: p }, { key, doc }) => {
      const t = textAt(doc, p)
      if (t == null) throw new Error(`no text file ${p}`)
      reads.set(key + p, t)
      return t
    },
  },
  tydig_write: {
    about: 'Replace a text file with your edited version (read it first): merged live with ' +
      'what people typed since. A new path makes the file.',
    args: { path: str('the file'), text: str('its whole new content') },
    run: async ({ path: p, text }, { key, doc }) => {
      if (!editable(p) || typeof text !== 'string' || text.length > 1e6) throw new Error('bad path or text')
      // a reference stays as it is, and only a person sets what is one
      if (p === TAGFILE || tagsOf(textAt(doc, TAGFILE), p)['read-only'])
        throw new Error(`${p} is read-only here: ask a person to make it editable`)
      await mergeInto(doc.getMap('files'), p, reads.get(key + p), text)
      reads.set(key + p, text)
      return 'written'
    },
  },
  tydig_reply: {
    about: 'Post in the Discussion. answers: the task id you answer (it is then done, in its thread).',
    args: { text: str('what you did, or a question'), answers: str('task id') },
    need: ['text'],
    run: ({ text, answers }, { me, doc }) => {
      const chat = doc.getArray('chat')
      const re = doc.getMap('comments').has(answers) ? answers : chat.toArray().find(m => m.id === answers)?.re
      chat.push([{ id: id(), author: me, agent: me, color: COLOR, text: text.trim(), ts: Date.now(),
        ...answers && { answers }, ...re && { re } }])
      return 'posted'
    },
  },
  tydig_comment: {
    about: 'Comment on a passage, quoted exactly: a paper against the claim, a stronger source, ' +
      'a reference that does not match, a claim needing a citation. Name the papers. ' +
      'Do not rewrite their text unless asked.',
    args: { file: str('e.g. main.typ'), quote: str('the passage, exactly'), text: str('your comment') },
    run: ({ file: f, quote, text }, { me, doc }) => {
      const t = doc.getMap('files').get(f), i = quote ? t?.toString().indexOf(quote) ?? -1 : -1
      if (i < 0) throw new Error(`"${String(quote).slice(0, 60)}" is not in ${f}: quote it exactly`)
      doc.getMap('comments').set(id(), { file: f, author: me, agent: me, color: COLOR, text: text.trim(),
        ts: Date.now(), anchor: relPos(t, i, 0), head: relPos(t, i + quote.length, -1) })
      return 'commented'
    },
  },
  tydig_search: {
    about: `Search for papers in ${Object.keys(SEARCH).join(', ')}. Search a claim several ways: ` +
      'its words, technical or MeSH terms, the opposite finding, reviews. Judge from the abstracts.',
    args: { query: str('words to search on'), source: str('one index (default: all)', { enum: Object.keys(SEARCH) }) },
    need: ['query'],
    run: async ({ query, source }) => {
      const from = source ? [source] : Object.keys(SEARCH), seen = new Set()
      const got = await Promise.allSettled(from.map(k => SEARCH[k](query)))
      const fresh = p => { const k = (p.doi || p.pmid || p.title).toLowerCase(); return !seen.has(k) && seen.add(k) }
      return { papers: got.flatMap(r => r.value || []).filter(fresh).map(brief),
        failed: got.map((r, i) => r.reason && `${from[i]}: ${r.reason.message}`).filter(Boolean) }
    },
  },
  tydig_cite: {
    about: "Add a paper to the bibliography from its registrar's record (a DOI, or a PMID): " +
      'returns the @key to put after the claim.',
    args: { doi: str('e.g. 10.1038/nature17946'), pmid: str('when it has no DOI') },
    need: [],
    run: async ({ doi, pmid }, { doc }) => {
      const p = doi ? await byDoi(doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')) : pmid && await byPmid(pmid)
      if (!p) throw new Error('give a DOI or PMID that exists (from tydig_search)')
      const bib = bibOf(doc), was = textAt(doc, bib) || '', r = await addTo(was, p)
      if (r.added) await mergeInto(doc.getMap('files'), bib, was, r.bib)
      return { key: r.key, added: !!r.added, title: p.title, bibliography: bib }
    },
  },
  tydig_check_refs: {
    about: 'Check every reference against its published record: ok, differs (how), missing, web, ' +
      'or error (could not check). With the sentences citing each, and keys cited but not in the bibliography.',
    run: async ({}, { doc }) => {
      const bib = bibOf(doc), entries = parseBib(textAt(doc, bib) || '')
      const typs = [...doc.getMap('files')].filter(([f]) => f.endsWith('.typ')).map(([f, t]) => [f, t.toString()])
      const all = re => typs.flatMap(([f, t]) => [...t.matchAll(re)].map(m => [f, m]))
      const cited = k => all(new RegExp(`[^.!?\\n]*@${reEsc(k)}\\b[^.!?\\n]*[.!?]?`, 'g')).slice(0, 3)
        .map(([file, m]) => ({ file, sentence: m[0].trim() }))
      const known = new Set([...entries.map(e => e.key), ...all(/<([\w:.-]+)>/g).map(([, m]) => m[1])])
      const keys = new Set(all(/(?<![\w.])@([A-Za-z][\w:-]*\w)(?![\w/])/g).map(([, m]) => m[1]))
      return {
        bibliography: bib,
        references: await Promise.all(entries.map(async e => {
          const r = await check(e).catch(err => ({ status: 'error', note: `could not reach Crossref: ${err.message}` }))
          return { key: e.key, title: e.fields.title, status: r.status, note: r.note, cited: cited(e.key) }
        })),
        not_in_bibliography: [...keys].filter(k => !known.has(k)),
      }
    },
  },
}
const LIST = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.about,
  inputSchema: { type: 'object', properties: t.args || {}, required: t.need ?? Object.keys(t.args || {}) } }))

// /api/agent/<project>/mcp, the token as a Bearer
export const mcp = express.Router({ mergeParams: true })
mcp.use((req, res, next) => {
  const t = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1], n = req.params.proj
  req.agent = t && isProj(n) && agentsOf(n).find(a => a.hash === hash(t))?.name
  req.agent ? next() : res.status(401).json({ error: 'not an agent token for this project' })
}, express.json({ limit: '4mb' })) // a whole file, escaped; read once the token is good
mcp.get('/mcp', (req, res) => res.status(405).end()) // no server-sent stream
mcp.post('/mcp', async (req, res) => {
  const { id: rid, method, params = {} } = req.body || {}
  const answer = result => res.json({ jsonrpc: '2.0', id: rid, result })
  if (rid === undefined) return res.status(202).end() // a notification
  if (method === 'initialize') return answer({ protocolVersion: params.protocolVersion || '2025-06-18',
    capabilities: { tools: {} }, serverInfo: { name: 'tydig', version: '2' } })
  if (method === 'ping') return answer({})
  if (method === 'tools/list') return answer({ tools: LIST })
  const tool = method === 'tools/call' && TOOLS[params.name]
  if (!tool) return res.json({ jsonrpc: '2.0', id: rid, error: { code: -32601, message: `no ${method} ${params.name || ''}` } })
  const n = req.params.proj, ctx = { me: req.agent, key: `${req.agent}|${n}|` }
  const [text, isError] = await live(n, doc => tool.run(params.arguments || {}, { ...ctx, doc }))
    .then(r => [typeof r === 'string' ? r : JSON.stringify(r, null, 1)], e => [String(e.message || e), true])
  answer({ content: [{ type: 'text', text }], isError: !!isError })
})
