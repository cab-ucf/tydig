// Surprise and AI-likeness over the text, from a Perplexiscope engine on this
// person's machine (like Ollama for ghost text): each word tinted by how much
// it surprised the model, each sentence underlined by its own, or tinted by
// how AI-like it reads (Fast-DetectGPT's criterion; a percentage once the
// engine is calibrated). Typst source is scored as the prose it typesets,
// not its markup: the engine sees text, the editor keeps where it came from.
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin, hoverTooltip } from '@codemirror/view'

// prose: the text a .typ file reads as, and for each of its characters the
// source position it stands for. Code (a # line, until its brackets close),
// comments, headings, math, references, labels and markup characters are
// left out; the [content] inside code stays.
export function prose(src, typst = true) {
  if (!typst) return { text: src, at: [...src].map((_, i) => i) }
  let text = '', at = [], open = 0
  const put = (c, i) => { text += c; at.push(i) }
  const depth = l => l.replace(/"(\\.|[^"])*"|\/\/.*/g, '').split('').reduce((d, c) => d + ('({'.includes(c)) - (')}'.includes(c)), 0)
  for (let i = 0; i <= src.length;) {
    const end = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i), line = src.slice(i, end)
    if (open > 0 || /^\s*(#|\/\/|=)/.test(line)) {
      open = Math.max(0, open + depth(line))
      if (text && !text.endsWith('\n')) put('\n', i) // a break, so no sentence runs across it
    } else {
      for (let j = i + (/^\s*([-+]|\d+\.)?\s*/.exec(line)[0].length); j < end;) {
        // inline code up to the [content] it chooses (#if c [a] else [b]: a, b), raw text, math, references
        const skip = /^(\/\/.*|\/\*[\s\S]*?\*\/|`[^`]*`|\$[^$]*\$|@[\w:.-]*\w|#(let|set|show|import|include)\b.*|#(if|for|while)\b[^\[\n]*|\]\s*else\b(\s+if\b[^\[\n]*)?|#[\w.]+(\([^()]*(\([^()]*\)[^()]*)*\))?|<[\w:.-]+>|\\)/.exec(src.slice(j, end))
        if (skip) { if (text && !/\s$/.test(text)) put(' ', j); j += skip[0].length; continue } // no two words glued over it
        if (!/[*_`\[\]]/.test(src[j])) put(src[j], j)
        j++
      }
      put(line.trim() ? ' ' : '\n', end) // a wrapped line joins its paragraph; a blank one ends it
    }
    i = end + 1
  }
  return { text, at }
}

const RAMP = [[242, 193, 78], [233, 128, 58], [194, 45, 86]]
const mix = t => { const u = Math.min(1.999, t * 2), i = u | 0, f = u - i; return RAMP[i].map((v, j) => Math.round(v + (RAMP[i + 1][j] - v) * f)) }
const tint = w => { const t = Math.min(1, w.bits / 16); return t < 0.12 ? '' : `rgba(${mix(t)},${(0.72 * t ** 1.6).toFixed(2)})` }
const lean = a => 'p' in a ? 2 * a.p - 1 : Math.max(-1, Math.min(1, a.z / 4)) // -1 reads human, +1 AI
const aiTint = a => { const t = lean(a); return Math.abs(t) < 0.1 ? '' : `rgba(${t > 0 ? '123,79,214' : '42,157,143'},${(0.55 * Math.abs(t) ** 1.3).toFixed(2)})` }
export const aiText = a => 'p' in a ? `${Math.round(100 * a.p)}% likely AI` : `AI z ${a.z >= 0 ? '+' : '−'}${Math.abs(a.z).toFixed(1)}`
const bits = x => `${x.toFixed(1)} bits`

const setScope = StateEffect.define()
const scopeField = StateField.define({
  create: () => Decoration.none,
  update: (d, tr) => tr.effects.find(e => e.is(setScope))?.value ?? d.map(tr.changes),
  provide: f => EditorView.decorations.from(f),
})

// opts: { url: () => the engine's address or null, by: () => 'bits' | 'ai', typst: () => is this a .typ,
//         report: ({ ppl, ai } | { error }) => void }
export function surprise(opts) {
  let ws, seq = 0, sent = null, view
  const ask = () => {
    const url = opts.url()
    if (!url || !view) return
    const p = prose(view.state.doc.toString(), opts.typst())
    if (ws?.readyState !== 1) {
      if (ws?.readyState === 0) return
      ws = new WebSocket(url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws')
      ws.onopen = ask
      ws.onerror = () => opts.report({ error: url })
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'heat' && m.seq === seq) show(m) }
      return
    }
    sent = p; ws.send(JSON.stringify({ seq: ++seq, text: p.text, cursor: null, k: 3, depth: 3, m: 'none', a: 0, T: 1 }))
  }
  const show = h => {
    const p = sent, cur = prose(view.state.doc.toString(), opts.typst())
    if (cur.text !== p.text) return ask() // typed since: ask about the text as it is now
    const src = (s, e) => [p.at[s], p.at[e - 1] + 1], ai = opts.by() === 'ai', marks = []
    for (const z of h.sents) {
      const [a, b] = src(z.s, z.e), c = ai ? aiTint(z) : tint({ bits: z.bits / z.w })
      if (a < b && c) marks.push(Decoration.mark({ class: ai ? 'scope-ai' : 'scope-sent', attributes: { style: ai ? `background:${c}` : `text-decoration-color:${c}` }, sent: z }).range(a, b))
    }
    if (!ai) for (const w of h.words) {
      const [a, b] = src(w.s, w.e), c = tint(w)
      marks.push(Decoration.mark({ attributes: c ? { style: `background:${c}` } : {}, word: w }).range(a, b))
    }
    view.dispatch({ effects: setScope.of(Decoration.set(marks, true)) })
    opts.report({ ppl: h.ppl, bpt: h.bpt, ai: h.ai })
  }
  let t
  const plugin = ViewPlugin.define(v => (view = v, setTimeout(ask), {
    update: u => { if (u.docChanged) { clearTimeout(t); t = setTimeout(ask, 700) } },
  }))
  const hover = hoverTooltip((v, pos) => {
    let w, z
    v.state.field(scopeField).between(pos, pos, (a, b, d) => { d.spec.word ? w = d.spec.word : d.spec.sent && (z = d.spec.sent) })
    if (!w && !z) return null
    return { pos, above: true, create: () => {
      const dom = Object.assign(document.createElement('div'), { className: 'cm-scope-tip' })
      if (w) dom.append(Object.assign(document.createElement('p'), { textContent: `${bits(w.bits)} · rank ${w.rank} · uncertainty ${bits(w.ent)}` + (w.toks.length > 1 ? ` · ${w.toks.map(([s, b]) => `${s.trim()} ${b.toFixed(1)}`).join(' + ')}` : '') }))
      if (z) dom.append(Object.assign(document.createElement('p'), { textContent: `sentence: ${bits(z.bits / z.w)} a word · ${aiText(z)}` }))
      return { dom }
    } }
  })
  const refresh = () => { if (!opts.url()) view?.dispatch({ effects: setScope.of(Decoration.none) }); else ask() }
  return { extension: [scopeField, plugin, hover], refresh }
}
