// Spelling and grammar as you type, and over the whole project: Harper
// (writewithharper.com), on the prose alone (surprise.js finds it), so markup
// and code are left be. It runs in a worker on this machine; the text goes
// nowhere. Words the project accepts live in .harper-dictionary.txt, as
// harper-ls keeps them.
import * as Y from 'yjs'
import MEDICAL from './dict/medical.txt?url'
import { later } from './warm.js'
import { prose } from './surprise.js'
import { Decoration, EditorView, ViewPlugin, showTooltip } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'

export const DICT = '.harper-dictionary.txt'
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}
let harper, words, terms
// sound English (or a house style), prose cut around code, or what Typst
// typesets itself (-- is an en dash) or means (..spread), that these misread
const OFF = { Dashes: false, DisjointPrefixes: false, EllipsisLength: false, ExpandMinimum: false,
  OxfordComma: false, SentenceCapitalization: false, Spaces: false, SplitWords: false, UnclosedQuotes: false }
// as word processors do: no spelling for ACRONYMS, NSF's, sha256, scRNA or (f)
const CODE = /\d|^[^\p{Ll}]+(['’]s)?$|.\p{Lu}|^\p{L}\.?$/u
const load = () => harper ??= later.then(() => Promise.all([import('harper.js'), import('harper.js/binary'), fetch(MEDICAL).then(r => r.text())])
  .then(async ([{ WorkerLinter }, { binary }, med]) => {
    terms = new Set(med.toLowerCase().split('\n'))
    const h = new WorkerLinter({ binary })
    await h.setLintConfig({ ...await h.getLintConfig(), ...OFF })
    return h
  }))

// Harper counts characters; the editor, UTF-16 units
const units = text => {
  if (!/[\uD800-\uDFFF]/.test(text)) return i => i
  const at = [0]; for (const c of text) at.push(at.at(-1) + c.length)
  return i => at[i]
}

// edits apart, a transposition one (Damerau)
const dist = (a, b) => {
  const d = [...Array(a.length + 1)].map((_, i) => [...Array(b.length + 1)].map((_, j) => i && j ? 0 : i + j))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]),
      a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity)
  return d[a.length][b.length]
}
// A slip is an edit (two, in a long word) from a word it might have meant, as
// most typing slips are; a term Harper does not know (phosphoproteomics) is
// not, nor one the medical list has, nor a plural of a known word (loadings),
// nor a closed compound (cleanroom). Doubled letters count for nothing (tommorow).
const once = t => t.replace(/(.)\1+/g, '$1')
const slip = (word, fixes) => {
  const w = word.toLowerCase(), f = fixes.map(x => x.toLowerCase()).filter(x => x.replace(/[ -]/g, '') !== w)
  const stems = [w.replace(/['’]s$/, ''), w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y')]
  if (stems.some(s => terms.has(s)) || w.length > 4 && f.some(x => stems.includes(x))) return false
  return f.some(x => Math.min(dist(w, x), dist(once(w), once(x))) <= (w.length > 8 ? 2 : 1))
}

// [{ from, to, word, message, spelling, fixes: [{ from, to, insert }] }]
export async function check(src, files) {
  const h = await load(), dict = files.get(DICT)?.toString() ?? ''
  if (dict !== words) {
    words = dict
    await h.clearWords(); await h.importWords(dict.split(/\s+/).filter(Boolean))
  }
  const { text, at } = prose(src), u = units(text)
  return (await h.lint(text, { language: 'plaintext' })).flatMap(l => {
    const a = u(l.span().start), b = u(l.span().end)
    const from = at[a], to = at[b - 1] + 1, word = text.slice(a, b), spelling = l.lint_kind() === 'Spelling'
    const fixes = l.suggestions().map(s => ({ from: s.kind() === 2 ? to : from, to, insert: s.get_replacement_text() }))
    // not what was written (it spans code that was cut out), only space, a
    // symbol or a name's part (PIs, dmsp.typ, #c.name, F&A), or no slip
    const token = /^\p{L}[^\s]*$/u.test(word) && (CODE.test(word) || /[#./_@&]/.test(src[from - 1]))
    if (b <= a || src.slice(from, to) !== word || !word.trim() || token ||
      spelling && !slip(word, fixes.map(x => x.insert))) return []
    return { from, to, word, message: l.message(), spelling, fixes }
  })
}

const accept = (files, word) => files.doc.transact(() => {
  const t = files.get(DICT) ?? (files.set(DICT, new Y.Text()), files.get(DICT))
  t.insert(t.length, word + '\n')
})

// ---- the editor: marks, and what to do about the one under the cursor ----
const found = StateEffect.define()
const marks = StateField.define({
  create: () => Decoration.none,
  // a mark goes as soon as its text is touched: fixed, or being fixed
  update: (d, tr) => tr.effects.find(e => e.is(found))?.value ??
    d.update({ filter: (from, to) => !tr.changes.touchesRange(from, to) }).map(tr.changes),
  provide: f => EditorView.decorations.from(f),
})
const tip = files => showTooltip.compute(['selection', marks], state => {
  const at = state.selection.main.head
  let hit; state.field(marks).between(at, at, (from, to, d) => { hit = { ...d.spec.lint, from, to } })
  return hit && { pos: hit.from, end: hit.to, above: true, create: view => {
    const dom = el('div', { className: 'cm-spell-tip' }, el('p', { textContent: hit.message }))
    const b = (text, run) => dom.append(el('button', { textContent: text, onmousedown: e => { e.preventDefault(); run() } }))
    const shift = hit.from - hit.found // the text may have moved since it was checked
    for (const f of hit.fixes.slice(0, 5))
      b(f.insert || '(remove)', () => view.dispatch({ changes: { from: f.from + shift, to: f.to + shift, insert: f.insert } }))
    if (hit.spelling) b(`add “${hit.word}” to the dictionary`, () => accept(files, hit.word))
    return { dom }
  } }
})
const run = files => ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view; this.later()
    // a word accepted, here or by anyone: check again
    this.dict = evs => evs.some(e => e.target === files.get(DICT) || e.keysChanged?.has(DICT)) && this.later()
    files.observeDeep(this.dict)
  }
  update(u) { if (u.docChanged) this.later() }
  later() { clearTimeout(this.t); this.t = setTimeout(() => this.lint(), 500) }
  async lint() {
    const doc = this.view.state.doc, all = await check(doc.toString(), files).catch(() => [])
    if (this.gone || this.view.state.doc !== doc) return // changed meanwhile: the next run has it
    this.view.dispatch({ effects: found.of(Decoration.set(all.map(f => Decoration.mark({
      class: f.spelling ? 'cm-spell' : 'cm-spell gram', lint: { ...f, found: f.from } }).range(f.from, f.to)))) })
  }
  destroy() { clearTimeout(this.t); this.gone = true; files.unobserveDeep(this.dict) }
})
// files: the project's Y.Map
export const spellcheck = files => [marks, tip(files), run(files)]

// ---- the whole project, in the side panel ----
export async function renderSpelling(body, { files, open }) {
  body.replaceChildren(el('p', { className: 'empty', textContent: 'checking every .typ file…' }))
  const out = []
  for (const p of [...files.keys()].filter(p => p.endsWith('.typ')).sort()) {
    const text = files.get(p).toString()
    for (const f of await check(text, files)) out.push(el('div', { className: 'ref', onclick: () => open(p, f.from, f.to) },
      el('b', { textContent: f.word }), ` ${f.fixes[0]?.insert ? '→ ' + f.fixes[0].insert : ''}`,
      el('small', { textContent: `${p}:${text.slice(0, f.from).split('\n').length} · ${f.message}` })))
  }
  body.replaceChildren(el('p', { className: 'hint',
    textContent: out.length ? `${out.length} to look at; click one to go there.` : 'Nothing to fix.' }), ...out)
}
