// Citations: find papers (PubMed or Crossref), cite them, and check that
// every reference in the bibliography is real and cited as it was published.
// A cited paper's BibTeX comes from Crossref by its DOI, the registrar's own
// record, never typed or generated; the check compares each entry with that
// record (or, without a DOI, the best Crossref match) and offers the fix.
import * as Y from 'yjs'
// searching and checking: shared with agent members (server/agent-mcp.mjs)
import { SEARCH, parseBib, keyFor, bibtex, check } from '../../server/refs.mjs'

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
const bibOf = files => files.has('refs.bib') ? 'refs.bib' : [...files.keys()].find(p => p.endsWith('.bib')) || 'refs.bib'

// ---- the panel ----
// ctx: { files (the Y.Map), view (the editor, or null), current (its path), query, at }
export function renderCite(body, ctx) {
  const results = el('div'), q = el('input', { className: 'cite-q', placeholder: 'search papers', value: ctx.query || '' })
  const src = el('select', {}, el('option', { value: 'pubmed', textContent: 'PubMed' }), el('option', { value: 'crossref', textContent: 'Crossref' }))
  src.value = localStorage.citeSource || 'pubmed'; src.onchange = () => localStorage.citeSource = src.value
  const status = m => results.replaceChildren(el('p', { className: 'empty', textContent: m }))
  const bibPath = () => bibOf(ctx.files)
  const bib = () => ctx.files.get(bibPath())?.toString() || ''

  // cite: the entry into the bibliography (once), @key into the text at `at`
  async function cite(p, at, btn) {
    btn.disabled = true
    const entries = parseBib(bib()), same = entries.find(e => p.doi && e.fields.doi?.toLowerCase() === p.doi.toLowerCase())
    const key = same?.key || keyFor(p, new Set(entries.map(e => e.key)))
    if (!same) {
      const entry = await bibtex(p, key), path = bibPath()
      ctx.files.doc.transact(() => {
        const t = ctx.files.get(path) ?? (ctx.files.set(path, new Y.Text()), ctx.files.get(path))
        t.insert(t.length, (t.length && !t.toString().endsWith('\n\n') ? '\n' : '') + entry + '\n')
      })
    }
    const v = ctx.view()
    if (v && ctx.current()?.endsWith('.typ')) {
      const doc = v.state.doc.toString()
      let pos = typeof at === 'function' ? at(doc) : at ?? v.state.selection.main.to
      while (pos > 0 && /\s/.test(doc[pos - 1])) pos-- // back onto the text, then before its full stop
      if (/[.,;:!?]/.test(doc[pos - 1] || '')) pos--
      v.dispatch({ changes: { from: pos, insert: ` @${key}` } })
    }
    btn.textContent = `cited @${key}`
  }
  const card = (p, at) => el('div', { className: 'paper' },
    el('a', { href: p.url, target: '_blank', rel: 'noopener', className: 'ptitle', textContent: p.title }),
    el('small', { textContent: [p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' et al.' : ''), p.year, p.venue,
      p.cites != null ? `cited ${p.cites}x` : ''].filter(Boolean).join(' · ') }),
    p.abstract ? el('p', { className: 'abs', textContent: p.abstract, onclick: e => e.target.classList.toggle('open') }) : '',
    el('button', { textContent: 'cite', onclick: e => cite(p, at, e.target) }))

  async function search() {
    if (!q.value.trim()) return
    status('searching...')
    try { const ps = await SEARCH[src.value](q.value); ps.length ? results.replaceChildren(...ps.map(p => card(p))) : status('nothing found') }
    catch (e) { status(`search failed: ${e.message}`) }
  }
  // each paragraph of the open file with no citation, and papers that could back it
  async function suggest() {
    const v = ctx.view(), text = v?.state.doc.toString() || ''
    const paras = [...text.matchAll(/(?:^|\n\n)((?:(?!\n\n)[\s\S])+)/g)].map(m => m[1])
      .map(p => ({ p, words: p.replace(/\/\/.*$/gm, '').replace(/#\w+(\([^)]*\))?|[*_=\[\]\\]/g, ' ').match(/[A-Za-z][\w-]{3,}/g) || [] }))
      .filter(x => x.words.length >= 15 && !/@[\w-]/.test(x.p)).slice(0, 6)
    if (!paras.length) return status('every paragraph here already cites something (or is too short to search on)')
    status(`finding papers for ${paras.length} paragraph(s)...`)
    const groups = []
    for (const { p, words } of paras) {
      const lead = p.slice(0, 60), at = doc => { const i = doc.indexOf(lead); if (i < 0) return v.state.selection.main.to; const e = doc.indexOf('\n\n', i); return (e < 0 ? doc.length : e) - (doc[e - 1] === '\n' ? 1 : 0) }
      // PubMed wants every word to match: its six most telling (longest) words; Crossref ranks twelve
      const terms = src.value === 'pubmed' ? [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 6) : words.slice(0, 12)
      let found = await SEARCH[src.value](terms.join(' ')).catch(() => [])
      if (!found.length && src.value === 'pubmed') found = await SEARCH.crossref(words.slice(0, 12).join(' ')).catch(() => []) // nothing in PubMed: wider
      groups.push(el('div', { className: 'para' }, el('blockquote', { textContent: p.slice(0, 160) + (p.length > 160 ? '...' : '') }),
        ...found.slice(0, 3).map(x => card(x, at))))
    }
    results.replaceChildren(...groups)
  }
  async function verify() {
    const entries = parseBib(bib())
    if (!entries.length) return status(`no references in ${bibPath()} yet`)
    status(`checking ${entries.length} reference(s) with Crossref...`)
    const rows = [], cited = new Set([...ctx.files].filter(([p]) => p.endsWith('.typ')).flatMap(([, t]) => [...t.toString().matchAll(/@([\w:.-]*[\w-])/g)].map(m => m[1])))
    for (const e of entries) {
      const r = await check(e).catch(err => ({ status: 'error', note: `could not reach Crossref (${err.message}); check again` }))
      const fix = r.paper && r.status === 'differs' && el('button', { textContent: 'use the published record', onclick: async ev => {
        ev.target.disabled = true
        const t = ctx.files.get(bibPath()), cur = parseBib(t.toString()).find(x => x.key === e.key)
        const entry = await bibtex(r.paper, e.key)
        ctx.files.doc.transact(() => { t.delete(cur.from, cur.to - cur.from); t.insert(cur.from, entry) })
        ev.target.textContent = 'fixed'
      } })
      rows.push(el('div', { className: `ref ${r.status}` }, el('b', { textContent: `${{ ok: '✓', differs: '!', missing: '✗', error: '?', web: '~' }[r.status]} @${e.key}` }),
        el('small', { textContent: (e.fields.title || '') + (cited.has(e.key) ? '' : ' (not cited in the text)') }),
        r.note ? el('p', { textContent: r.status === 'differs' ? `published as: ${r.note}` : r.note }) : '', fix || ''))
    }
    const bad = rows.filter(r => !/\b(ok|web)\b/.test(r.className)).length
    results.replaceChildren(el('p', { className: 'hint', textContent: bad ? `${bad} of ${entries.length} need attention` : `all ${entries.length} match their published records` }), ...rows)
  }
  q.onkeydown = e => e.key === 'Enter' && search()
  body.replaceChildren(el('div', { className: 'cite-bar' }, q, src, el('button', { textContent: 'search', onclick: search })),
    el('div', { className: 'cite-bar' }, el('button', { textContent: 'suggest for this file', onclick: suggest }),
      el('button', { textContent: 'check references', onclick: verify })), results)
  if (ctx.query) search()
}
