// Citations: find papers (PubMed or Crossref), cite them, and check that
// every reference in the bibliography is real and cited as it was published.
// A cited paper's BibTeX comes from Crossref by its DOI, the registrar's own
// record, never typed or generated; the check compares each entry with that
// record (or, without a DOI, the best Crossref match) and offers the fix.
import * as Y from 'yjs'

const CR = 'https://api.crossref.org/works', PM = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
const plain = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
// how alike two titles are: the share of words they have in common
const alike = (a, b) => { const x = new Set(plain(a).split(' ')), y = new Set(plain(b).split(' ')); return 2 * [...x].filter(w => y.has(w)).length / (x.size + y.size || 1) }
const json = u => fetch(u).then(r => r.ok ? r.json() : Promise.reject(Object.assign(new Error(`${new URL(u).host}: ${r.status}`), { status: r.status })))

// ---- searching ----
const fromCrossref = w => ({ title: w.title?.[0] || '(untitled)', authors: (w.author || []).map(a => a.family || a.name).filter(Boolean),
  year: w.issued?.['date-parts']?.[0]?.[0], venue: w['container-title']?.[0], doi: w.DOI, cites: w['is-referenced-by-count'],
  abstract: (w.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), url: `https://doi.org/${w.DOI}` })
async function searchCrossref(q) {
  const r = await json(`${CR}?query.bibliographic=${encodeURIComponent(q)}&rows=8&select=DOI,title,author,issued,container-title,is-referenced-by-count,abstract`)
  return r.message.items.map(fromCrossref)
}
async function searchPubmed(q) {
  const ids = (await json(`${PM}/esearch.fcgi?db=pubmed&sort=relevance&retmax=8&retmode=json&term=${encodeURIComponent(q)}`)).esearchresult.idlist
  if (!ids.length) return []
  const xml = new DOMParser().parseFromString(await (await fetch(`${PM}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids}`)).text(), 'text/xml')
  return [...xml.querySelectorAll('PubmedArticle')].map(a => {
    const t = s => a.querySelector(s)?.textContent?.trim(), pmid = t('PMID')
    return { title: t('ArticleTitle'), authors: [...a.querySelectorAll('AuthorList > Author > LastName')].map(n => n.textContent),
      year: Number(t('JournalIssue PubDate Year') || t('ArticleDate Year') || (t('MedlineDate') || '').slice(0, 4)) || undefined,
      venue: t('Journal > Title'), doi: a.querySelector('ArticleId[IdType="doi"]')?.textContent, pmid,
      abstract: [...a.querySelectorAll('AbstractText')].map(x => x.textContent).join(' '), url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` }
  })
}
const SEARCH = { pubmed: searchPubmed, crossref: searchCrossref }

// ---- the bibliography ----
// @type{key, field = {value} or "value" or bare, ...}: enough of BibTeX to check and edit entries
function parseBib(text) {
  const out = []
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    const m = /^@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(text.slice(i))
    if (!m) continue
    let depth = 0, j = i + m[0].indexOf('{') // from the entry's own brace
    for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break }
    const body = text.slice(i + m[0].length, j), fields = {}
    for (const f of body.matchAll(/(\w+)\s*=\s*(\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|"([^"]*)"|([\w.-]+))/g))
      fields[f[1].toLowerCase()] = (f[3] ?? f[4] ?? f[5]).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
    out.push({ type: m[1].toLowerCase(), key: m[2], fields, from: i, to: j + 1 })
    i = j
  }
  return out
}
const bibOf = files => files.has('refs.bib') ? 'refs.bib' : [...files.keys()].find(p => p.endsWith('.bib')) || 'refs.bib'
const keyFor = (p, taken) => {
  const base = plain(p.authors[0] || 'anon').split(' ').pop() + (p.year || '') + (plain(p.title).split(' ').find(w => w.length > 3) || '')
  let k = base; for (let n = 0; taken.has(k); n++) k = base + 'abcdefghijklmnopqrstuvwxyz'[n % 26]
  return k
}
// the registrar's BibTeX for a DOI; a PubMed paper without one, from its PubMed record
async function bibtex(p, key) {
  if (p.doi) {
    const t = await fetch(`${CR}/${encodeURIComponent(p.doi)}/transform/application/x-bibtex`).then(r => r.ok ? r.text() : null)
    if (t) return t.trim().replace(/^@(\w+)\{[^,]*,/, `@$1{${key},`).replace(/, (\w+)=/g, ',\n  $1 = ').replace(/ \}$/, '\n}')
  }
  return `@article{${key},\n  title = {${p.title}},\n  author = {${p.authors.join(' and ')}},\n  journal = {${p.venue || ''}},\n  year = {${p.year || ''}},\n  note = {PMID: ${p.pmid}},\n  url = {${p.url}}\n}`
}

// ---- checking ----
const families = s => String(s || '').split(/\s+and\s+/i).map(a => plain(a.includes(',') ? a.split(',')[0] : a.split(' ').pop()))
async function check(e) {
  const f = e.fields, doi = f.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  // a web page or report has no registry record to hold it to
  if (!doi && /^(misc|online|electronic|www|manual|techreport|unpublished)$/.test(e.type))
    return { status: 'web', note: `not a published paper, so not checkable here: open ${f.url || 'its source'} and confirm it` }
  // a lookup that fails is "could not check", never "does not exist"; only a 404 is an answer
  let w = doi && await json(`${CR}/${encodeURIComponent(doi)}`).then(r => r.message, err => err.status === 404 ? null : Promise.reject(err))
  if (!w && f.title) w = (await json(`${CR}?query.bibliographic=${encodeURIComponent(`${f.title} ${families(f.author)[0] || ''}`)}&rows=1`)).message.items[0]
  if (!w || alike(w.title?.[0], f.title) < 0.8) return { status: 'missing', note: doi ? `no published paper matches DOI ${doi}` :
    'no published paper matches this title: check it exists, and add its DOI' }
  const p = fromCrossref(w), issues = []
  if (alike(p.title, f.title) < 0.95) issues.push(`title: "${p.title}"`)
  const mine = families(f.author), theirs = p.authors.map(plain)
  if (theirs.length && (mine.length !== theirs.length || mine.some((a, i) => a !== theirs[i]))) issues.push(`authors: ${p.authors.join(', ')}`)
  if (p.year && f.year && Number(f.year) !== p.year) issues.push(`year: ${p.year}`)
  if (p.venue && f.journal && alike(p.venue, f.journal) < 0.6) issues.push(`journal: ${p.venue}`)
  if (!doi) issues.push(`DOI: ${p.doi}`)
  return { status: issues.length ? 'differs' : 'ok', note: issues.join('; '), paper: p }
}

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
      if (!found.length && src.value === 'pubmed') found = await searchCrossref(words.slice(0, 12).join(' ')).catch(() => []) // nothing in PubMed: wider
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
