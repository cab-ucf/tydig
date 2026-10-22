// The preview and its sources, letter by letter (case, forms and markup
// aside): 12 letters in a row found in the sources are, in the preview, that
// source text. From the preview to the source (a double-click), and back
// (the cursor, AI-likeness).
import { $ } from './util.js'
import { files, GEN } from './doc.js'
import { prose } from './surprise.js'

const N = 12, LN = /[\p{L}\p{N}]/u
// each letter of s, folded, onto k; at: what each stands for, by f(index)
function fold(s, k, at, f) {
  let i = 0
  for (const ch of s) {
    for (const c of ch.normalize('NFKC').toLowerCase()) if (c.length === 1 && LN.test(c)) k.push(c), at.push(f(i))
    i += ch.length
  }
}
// every text file as one run of letters (a .typ, as the prose it sets); each
// 12 letters -> where they start (a list, where more than once)
let src = null
files.observeDeep(() => src = null)
function sources() {
  if (src) return src
  const k = [], at = [], spans = []
  for (const [file, t] of files) {
    if (GEN.test(file)) continue
    const s = t.toString(), p = file.endsWith('.typ') && prose(s)
    spans.push([file, k.length])
    fold(p ? p.text : s, k, at, p ? i => p.at[i] : i => i)
    k.push('\0'); at.push(-1) // no run crosses files
  }
  const K = k.join(''), at12 = new Map()
  for (let i = 0; i + N <= K.length; i++) {
    const g = K.substr(i, N), x = at12.get(g)
    x == null ? at12.set(g, i) : x.push ? x.length < 16 && x.push(i) : at12.set(g, [x, i])
  }
  return src = { at, spans, at12 }
}
const fileOf = (spans, g) => spans.findLast(([, s]) => s <= g)[0]
// the preview's letters, each [text node, offset], and where each came from
// (-1: unknown): text found once, then text found more than once, where it
// goes on from the text before it, else in its file, else in a .typ
function align() {
  const s = sources(), k = [], at = [], w = document.createTreeWalker($('page'), NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) if (!n.parentElement.closest('style')) fold(n.data, k, at, i => [n, i])
  const K = k.join(''), to = new Int32Array(K.length).fill(-1), put = (q, i) => {
    for (let j = 0; j < N; j++) to[q + j] < 0 && (to[q + j] = i + j)
  }
  for (let q = 0; q + N <= K.length; q++) { const i = s.at12.get(K.substr(q, N)); i >= 0 && put(q, i) }
  for (let q = 0, last = -1; q + N <= K.length; q++) {
    const is = to[q] < 0 && s.at12.get(K.substr(q, N)), f = last >= 0 && fileOf(s.spans, last)
    if (is?.push) put(q, is.find(i => i === last + 1) ?? is.find(i => fileOf(s.spans, i) === f)
      ?? is.find(i => fileOf(s.spans, i).endsWith('.typ')) ?? is[0])
    if (to[q] >= 0) last = to[q]
  }
  return { s, at, to }
}

// the source of the preview's text in range r: {file, from, to}
export function toSource(r) {
  const { s, at, to } = align(), x0 = at.findIndex(([n, i]) => r.comparePoint(n, i) >= 0)
  if (x0 < 0) return null
  const x1 = Math.max(x0, at.findLastIndex(([n, i]) => r.comparePoint(n, i + 1) <= 0))
  const pos = g => s.at[g], file = g => fileOf(s.spans, g)
  if (to[x0] >= 0 && to[x1] >= to[x0] && file(to[x0]) === file(to[x1]))
    return { file: file(to[x0]), from: pos(to[x0]), to: pos(to[x1]) + 1 }
  // else the code that made it (a #lorem, a value from data): the first line
  // between the nearest known text of one file on either side (a .typ's
  // first), else after the nearest before, else the nearest after
  const near = (x, d) => {
    const m = new Map()
    for (let q = x; q >= 0 && q < to.length && Math.abs(q - x) < 5000; q += d) to[q] >= 0 && !m.has(file(to[q])) && m.set(file(to[q]), q)
    return [...m].sort(([f, a], [g, b]) => !f.endsWith('.typ') - !g.endsWith('.typ') || Math.abs(a - x) - Math.abs(b - x))
  }
  const line = (f, a, z) => { // the first line in [a, z) with code on it, else with anything
    const t = files.get(f).toString().slice(a, z).replace(/\/\/[^\n]*/g, c => ' '.repeat(c.length))
    const m = /[^\n]*#[^\n]*/.exec(t) ?? /\S[^\n]*/.exec(t), i = a + (m?.index ?? 0) + (m?.[0].search(/\S/) ?? 0)
    return { file: f, from: i, to: i + (m?.[0].trim().length ?? 0) }
  }
  const ls = near(x0 - 1, -1), hs = new Map(near(x1 + 1, 1)), typ = ([f]) => f.endsWith('.typ')
  const pairs = ls.filter(([f, l]) => to[l] < to[hs.get(f)]), [f, l, h] = [pairs.filter(typ), ls.filter(typ),
    pairs, ls].find(c => c.length)?.[0] ?? [...hs].map(([f, h]) => [f, null, h])[0] ?? []
  if (!f) return null
  if (l == null) return { file: f, from: pos(to[h]), to: pos(to[h]) + 1 }
  return line(f, pos(to[l]) + 1, hs.has(f) && to[l] < to[hs.get(f)] ? pos(to[hs.get(f)]) : Infinity)
}

// where in the preview each of a file's [from, to) spans is: Ranges for
// each, one a stretch of the preview
export function toPreview(file, spans) {
  const { s, at, to } = align(), f = s.spans.findIndex(([p]) => p === file), out = spans.map(() => [])
  if (f < 0) return out
  const a = s.spans[f][1], b = s.spans[f + 1]?.[1] ?? Infinity
  for (let q = 0; q < to.length; q++) {
    const g = to[q], p = s.at[g]
    if (g < a || g >= b) continue
    spans.forEach(([from, t], j) => p >= from && p < t && out[j].push(q))
  }
  return out.map(qs => {
    const rs = []
    for (let i = 0; i < qs.length; i++) {
      let e = i
      while (qs[e + 1] - qs[e] < 40) e++
      const r = document.createRange(), [n0, o0] = at[qs[i]], [n1, o1] = at[qs[e]]
      r.setStart(n0, o0); r.setEnd(n1, o1 + 1); rs.push(r); i = e
    }
    return rs
  })
}
