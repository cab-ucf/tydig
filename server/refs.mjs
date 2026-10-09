// Papers and references, for the Cite panel (client/src/cite.js) and for agent
// members (agent-mcp.mjs) alike: search three indexes, cite by the
// registrar's own record, and check that each reference is real and cited
// as it was published. No DOM, so it runs in a browser and in Node.
const env = globalThis.process?.env || {}
const CR = env.TYDIG_CROSSREF || 'https://api.crossref.org/works', PM = env.TYDIG_PUBMED || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const OA = env.TYDIG_OPENALEX || 'https://api.openalex.org/works'
export const plain = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
// how alike two titles are: the share of words they have in common
export const alike = (a, b) => { const x = new Set(plain(a).split(' ')), y = new Set(plain(b).split(' ')); return 2 * [...x].filter(w => y.has(w)).length / (x.size + y.size || 1) }
const json = u => fetch(u).then(r => r.ok ? r.json() : Promise.reject(Object.assign(new Error(`${new URL(u).host}: ${r.status}`), { status: r.status })))
const untag = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

// ---- searching: each index ranks, and covers, differently ----
export const fromCrossref = w => ({ title: untag(w.title?.[0]) || '(untitled)', authors: (w.author || []).map(a => a.family || a.name).filter(Boolean),
  year: w.issued?.['date-parts']?.[0]?.[0], venue: w['container-title']?.[0], doi: w.DOI, cites: w['is-referenced-by-count'],
  abstract: untag(w.abstract), url: `https://doi.org/${w.DOI}`, from: 'crossref' })
// (not a paper's supplementary files, which Crossref also registers)
const crossref = async q => (await json(`${CR}?query.bibliographic=${encodeURIComponent(q)}&rows=12&select=DOI,type,title,author,issued,container-title,is-referenced-by-count,abstract`))
  .message.items.filter(w => w.type !== 'component' && w.title?.[0]).slice(0, 8).map(fromCrossref)
// PubMed's records, read from its XML without a DOM: the few fields a citation needs
const inner = (s, t) => [...s.matchAll(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'g'))].map(m => m[1])
const tags = (s, t) => inner(s, t).map(untag)
const pmids = async ids => ids.length ? (await (await fetch(`${PM}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids}`)).text()).split('<PubmedArticle>').slice(1).map(a => {
  const pmid = tags(a, 'PMID')[0], date = tags(a, 'PubDate')[0] || ''
  return { title: tags(a, 'ArticleTitle')[0], authors: tags(inner(a, 'AuthorList')[0] || '', 'LastName'), year: Number(/\d{4}/.exec(date)?.[0]) || undefined,
    venue: tags(inner(a, 'Journal')[0] || '', 'Title')[0], doi: /<ArticleId IdType="doi">([^<]+)</.exec(a)?.[1], pmid,
    abstract: tags(a, 'AbstractText').join(' '), url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, from: 'pubmed' }
}) : []
const pubmed = async q => pmids((await json(`${PM}/esearch.fcgi?db=pubmed&sort=relevance&retmax=8&retmode=json&term=${encodeURIComponent(q)}`)).esearchresult.idlist)
// OpenAlex needs a key (free; OPENALEX_API_KEY), so only where one is set: never in a browser
const openalex = async q => (await json(`${OA}?search=${encodeURIComponent(q)}&per-page=8&api_key=${env.OPENALEX_API_KEY}`)).results.map(w => ({
  title: w.title || '(untitled)', authors: (w.authorships || []).map(a => a.author?.display_name?.split(' ').pop()).filter(Boolean),
  year: w.publication_year, venue: w.primary_location?.source?.display_name, doi: w.doi?.replace(/^https:\/\/doi\.org\//, ''), cites: w.cited_by_count,
  abstract: Object.entries(w.abstract_inverted_index || {}).flatMap(([t, at]) => at.map(i => [i, t])).sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' '),
  url: w.doi || w.id, from: 'openalex' }))
export const SEARCH = { pubmed, crossref, ...env.OPENALEX_API_KEY && { openalex } }
export const byPmid = async id => (await pmids([id]))[0]
export const byDoi = async doi => fromCrossref((await json(`${CR}/${encodeURIComponent(doi)}`)).message)

// ---- the bibliography ----
// @type{key, field = {value} or "value" or bare, ...}: enough of BibTeX to check and edit entries
export function parseBib(text) {
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
export const keyFor = (p, taken) => {
  const base = plain(p.authors[0] || 'anon').split(' ').pop() + (p.year || '') + (plain(p.title).split(' ').find(w => w.length > 3) || '')
  let k = base; for (let n = 0; taken.has(k); n++) k = base + 'abcdefghijklmnopqrstuvwxyz'[n % 26]
  return k
}
// the registrar's BibTeX for a DOI; a PubMed paper without one, from its PubMed record
export async function bibtex(p, key) {
  if (p.doi) {
    const t = await fetch(`${CR}/${encodeURIComponent(p.doi)}/transform/application/x-bibtex`).then(r => r.ok ? r.text() : null)
    if (t) return t.trim().replace(/^@(\w+)\{[^,]*,/, `@$1{${key},`).replace(/, (\w+)=/g, ',\n  $1 = ').replace(/ \}$/, '\n}')
  }
  return `@article{${key},\n  title = {${p.title}},\n  author = {${p.authors.join(' and ')}},\n  journal = {${p.venue || ''}},\n  year = {${p.year || ''}},\n  note = {PMID: ${p.pmid}},\n  url = {${p.url}}\n}`
}
// bib with p in it (once, found by DOI): its key and the new text
export async function addTo(bib, p) {
  const entries = parseBib(bib), same = entries.find(e => p.doi && e.fields.doi?.toLowerCase() === p.doi.toLowerCase())
  if (same) return { key: same.key, bib }
  const key = keyFor(p, new Set(entries.map(e => e.key)))
  return { key, bib: bib + (bib.length && !bib.endsWith('\n\n') ? '\n' : '') + await bibtex(p, key) + '\n', added: true }
}

// ---- checking ----
const families = s => String(s || '').split(/\s+and\s+/i).map(a => plain(a.includes(',') ? a.split(',')[0] : a.split(' ').pop()))
export async function check(e) {
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
