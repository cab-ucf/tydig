// Surprise, flatness and AI-likeness over the text, from a Perplexiscope
// engine (the hub's, or one on this person's machine): each word tinted by how
// much it surprised the model, or by how flat the model's guesses were before
// it, each sentence underlined on the same scale; or each sentence tinted by
// how rare its AI-likeness is among human writing, by MELD (an AI-text
// detector) where the engine runs it. Typst source is scored as the prose it
// typesets: the engine sees text, the editor keeps where it came from.
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin, hoverTooltip } from '@codemirror/view'

// prose: the text a .typ file reads as, and for each of its characters the
// source position it stands for. Typst's two modes, scanned: markup is text
// (headings and list items too) less its markup characters, math, raw text,
// comments, labels and references; code (after a #, to the end of its
// expression or statement) gives only its [content] blocks, and its strings
// that read as prose ("Thermal relaxation of water", "Approach", never
// "fig.png"); an #if's branches are kept apart.
const SKIP = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(`{3,})[\s\S]*?\1|`[^`]*`|\$(\\.|[^$\\])*\$|<[\w:.-]+>|@[\w:.-]*\w/y
const KEYWORD = /(let|set|show|import|include|if|for|while|context|return)\b/y
const STRING = /"(\\.|[^"\\])*"?/y, PARA = /\n[ \t]*\n/y, LINE = /[ \t]*(=+[ \t]+|[-+/][ \t]+|\d+\.[ \t]+)?/y
const FONT = /\b(font|family)\s*:\s*\(?\s*("[^"]*"\s*,\s*)*$/ // a font's name is not prose
export function prose(src, typst = true) {
  if (!typst) return { text: src, at: [...src].map((_, i) => i) }
  const out = [], at = []
  let i = 0
  const put = (c, j) => { out.push(c); at.push(j) }
  const stick = re => (re.lastIndex = i, re.exec(src)?.[0])
  // a space or a break between two runs of text (a break ends any sentence)
  const sep = (c, j) => {
    const l = out.at(-1)
    if (!l || l === '\n') return
    if (l !== ' ') put(c, j)
    else if (c === '\n') out[out.length - 1] = c
  }
  const string = () => {
    const s = stick(STRING), from = i; i += s.length
    if (!/\p{L}{2,}\s+\p{L}|^"\p{Lu}\p{Ll}+"$/u.test(s) || FONT.test(src.slice(Math.max(0, from - 200), from))) return
    sep('\n', from)
    for (let j = from + 1; j < from + s.length - 1; j++)
      src[j] === '\\' ? put('nt'.includes(src[++j]) ? ' ' : src[j], j) : put(src[j], j)
    sep('\n', i)
  }
  const code = () => { // just after a #: one expression, or a statement to its line's end
    const stmt = !!stick(KEYWORD)
    for (let depth = 0; i < src.length;) {
      const c = src[i], skip = stick(SKIP)
      if (skip) { i += skip.length; continue }
      if (c === '"') { string(); continue }
      if (c === '[') {
        if (stmt) sep('\n', i)
        i++; markup(true)
        if (!depth && !stmt && src[i] !== '[') return
        continue
      }
      if ('({'.includes(c)) { depth++; i++; continue }
      if (')}'.includes(c)) {
        if (!depth) return
        i++
        if (!--depth && !stmt && !/[.(\[]/.test(src[i])) return
        continue
      }
      if (!depth && (c === '\n' || c === ';' || !stmt && !/[\w.-]/.test(c) ||
        !stmt && c === '.' && !/\w/.test(src[i + 1]))) return
      i++
    }
  }
  const markup = block => { // to the ] that closes a [content] block, or the end
    let sol = true, heading = false
    while (i < src.length) {
      const c = src[i]
      if (sol) { const m = stick(LINE); i += m.length; heading = m.includes('='); sol = false; continue }
      if (block && c === ']') { i++; return }
      if (c === '\n') { sep(heading || stick(PARA) ? '\n' : ' ', i); i++; sol = true; continue }
      const skip = '/`$<@'.includes(c) && !(c === '/' && src[i - 1] === ':') && stick(SKIP) // (https:// is a link)
      if (skip) { sep(' ', i); i += skip.length; continue }
      if (c === '#') { const n = out.length; i++; code(); if (out.length === n) sep(' ', i); continue }
      if (c === '\\') { /\s/.test(src[i + 1] ?? ' ') ? sep(' ', i) : put(src[i + 1], i + 1); i += 2; continue }
      if (' \t~'.includes(c)) sep(' ', i)
      else if (!'*_[]'.includes(c)) put(c, i)
      i++
    }
  }
  markup(false)
  return { text: out.join(''), at }
}

// what the text can be highlighted by: [name, what it shows]
export const MODES = {
  bits: ['surprise', 'how unexpected each word was to the model'],
  ent: ['flatness', 'how unsure the model was before each word: flat means many words could have come next'],
  ai: ['AI-likeness', 'how rarely human sentences read as AI-like as each one (MELD): the more violet, the rarer'],
}
const ramp = R => x => {
  const t = Math.min(1, x), u = Math.min(1.999, t * 2), i = u | 0, f = u - i
  const rgb = R[i].map((v, j) => Math.round(v + (R[i + 1][j] - v) * f))
  return t < 0.12 ? '' : `rgba(${rgb},${(0.72 * t ** 1.6).toFixed(2)})`
}
const hot = ramp([[242, 193, 78], [233, 128, 58], [194, 45, 86]])
const cold = ramp([[198, 219, 239], [107, 174, 214], [33, 113, 181]])
const tint = { bits: b => hot(b / 16), ent: b => cold(b / 12) }
// MELD's reading: a text's tail is the share of human texts that score at
// least as AI-like; ai is undefined while it reads, null where it does not run
const rare = t => Math.max(0, Math.min(1, Math.log10(0.1 / t) / 2)) // 0 at 1 in 10, 1 at 1 in 1,000
const aiTint = a => rare(a.tail) ? `rgba(123,79,214,${(0.6 * rare(a.tail)).toFixed(2)})` : ''
const share = (t, of) => t >= 0.1 ? `typical of human ${of}`
  : `at most ${(100 * t).toFixed(t < 0.01 ? 1 : 0)}% of human ${of} score this AI-like`
export const aiText = a => a === undefined ? 'AI …' : !a ? 'no AI detector'
  : `AI: ${a.words < 100 ? 'too short' : a.tail <= 0.01 ? 'flagged' : a.tail < 0.1 ? 'unusual' : 'typical'}`
export const aiAbout = a => a === undefined ? 'MELD is still reading it.' : !a ? 'This engine runs no AI detector.' :
  `MELD: ${a.words < 100 ? 'needs 100+ words to judge; ' : ''}${share(a.tail, 'documents')}` +
  `${a.tail < 0.1 ? `; closest to ${a.family}, ${a.task}` : ''}.`
const bits = x => `${x.toFixed(1)} bits`
const big = n => n < 1e6 ? Math.round(n).toLocaleString() : `10^${Math.round(Math.log10(n))}`
const el = (tag, props) => Object.assign(document.createElement(tag), props)
const row = (dl, k, v, on) =>
  dl.append(el('dt', { textContent: k, className: on ? 'on' : '' }), el('dd', { textContent: v, className: on ? 'on' : '' }))
const chance = b => b < 3.33 ? `a ${Math.round(100 * 2 ** -b)}% chance` : `a 1 in ${big(2 ** b)} chance`

const setScope = StateEffect.define()
const scopeField = StateField.define({
  create: () => Decoration.none,
  update: (d, tr) => tr.effects.find(e => e.is(setScope))?.value ?? d.map(tr.changes),
  provide: f => EditorView.decorations.from(f),
})

// opts: url () an engine's address on this machine, or null; hub () the hub's
// route, or null; by () 'bits' | 'ent' | 'ai'; typst () is this a .typ;
// report ({ ppl, ai } | { error }); after, a promise to wait for first
export function surprise(opts) {
  let ws, seq = 0, sent = null, view, last = null
  const ask = async () => {
    await opts.after
    const url = opts.url(), hub = opts.hub()
    if (!(url || hub) || !view) return
    const p = prose(view.state.doc.toString(), opts.typst())
    if (hub) { // the hub's own engine: the newest ask wins there too
      const n = ++seq; sent = p
      return fetch(hub, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: p.text }).then(r => r.json())
        .then(h => n === seq && (h.error ? opts.report({ error: h.error }) : heat(h, hub, n)),
          e => opts.report({ error: e.message }))
    }
    if (ws?.readyState !== 1) {
      if (ws?.readyState === 0) return
      ws = new WebSocket(url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws')
      ws.onopen = ask
      ws.onerror = () => opts.report({ error: `no Perplexiscope engine at ${url}: start it there (just, in its folder)` })
      ws.onmessage = e => { const m = JSON.parse(e.data)
        if (m.type === 'error') opts.report({ error: m.message })
        else if (m.seq !== seq) return
        else if (m.type === 'heat') heat(m)
        else if (m.type === 'ai') addAi(m.sents ? m : null) }
      return
    }
    sent = p; ws.send(JSON.stringify({ seq: ++seq, text: p.text, cursor: null, k: 3, depth: 3, m: 'none', a: 0, T: 1 }))
  }
  const show = h => {
    const p = sent, cur = prose(view.state.doc.toString(), opts.typst())
    if (cur.text !== p.text) return ask() // typed since: ask about the text as it is now
    const src = (s, e) => [p.at[s], p.at[e - 1] + 1], marks = []
    const by = MODES[opts.by()] ? opts.by() : 'bits', ai = by === 'ai'
    let i = 0
    for (const z of h.sents) { // a sentence is its z.w words, in order
      z.ent = h.words.slice(i, i += z.w).reduce((t, w) => t + w.ent, 0) / z.w
      const [a, b] = src(z.s, z.e), c = ai ? z.ai && aiTint(z.ai) : tint[by](by === 'ent' ? z.ent : z.bits / z.w)
      const style = c ? { style: ai ? `background:${c}` : `text-decoration-color:${c}` } : {}
      if (a < b) marks.push(Decoration.mark({ class: ai ? 'scope-ai' : 'scope-sent', attributes: style, sent: z }).range(a, b))
    }
    if (!ai) for (const w of h.words) {
      const [a, b] = src(w.s, w.e), c = tint[by](w[by])
      marks.push(Decoration.mark({ attributes: c ? { style: `background:${c}` } : {}, word: w }).range(a, b))
    }
    last = h
    view.dispatch({ effects: setScope.of(Decoration.set(marks, true)) })
    opts.report({ ppl: h.ppl, bpt: h.bpt, ai: h.ai })
  }
  // MELD's reading of the text just shown, laid onto its sentences
  const addAi = a => {
    if (!last) return
    last.ai = a
    a?.sents?.forEach((x, i) => last.sents[i] && (last.sents[i].ai = x))
    show(last)
  }
  const heat = (h, hub, n) => { // fresh scores; then ask the hub for MELD's (an engine here sends it unasked)
    h.ai = undefined; show(h)
    if (hub && last === h) fetch(hub + '?ai', { method: 'POST', headers: { 'content-type': 'text/plain' },
      body: sent.text }).then(r => r.json())
      .then(r => n === seq && last === h && (r.error ? opts.report({ error: r.error }) : addAi(r.ai)), () => {})
  }
  let t
  const plugin = ViewPlugin.define(v => (view = v, setTimeout(ask), {
    update: u => { if (u.docChanged) { clearTimeout(t); t = setTimeout(ask, 700) } },
  }))
  const hover = hoverTooltip((v, pos) => {
    let w, z
    v.state.field(scopeField).between(pos, pos, (a, b, d) => {
      d.spec.word ? w = d.spec.word : d.spec.sent && (z = d.spec.sent)
    })
    if (!w && !z) return null
    return { pos, above: true, create: () => {
      const dl = el('dl'), dom = el('div', { className: 'cm-scope-tip' })
      dom.append(dl)
      const by = opts.by()
      if (w) {
        row(dl, 'Surprise', `${bits(w.bits)}: the model gave this word ${chance(w.bits)}`, by === 'bits')
        row(dl, 'Rank', w.rank === 1 ? "the model's first guess" : `#${big(w.rank)} among the model's guesses`)
        row(dl, 'Flatness', `${bits(w.ent)}: ` + (w.ent < 0.5 ? 'the model was all but sure what came next' :
          `before it, the model was as unsure as if picking from ${big(2 ** w.ent)} equally likely words`), by === 'ent')
        if (w.toks.length > 1)
          row(dl, 'Pieces', w.toks.map(([t, b]) => `${t.trim()} ${b.toFixed(1)}`).join(' + ') + ' bits')
      }
      if (z) {
        row(dl, 'Sentence', `${z.w} words; a word averages ${bits(z.bits / z.w)} of surprise, ` +
          `${bits(z.ent)} of flatness`)
        row(dl, 'AI-likeness', z.ai ? share(z.ai.tail, 'sentences') : last?.ai === undefined ? 'MELD is still reading' :
          last.ai ? 'too short to judge' : 'this engine runs no AI detector', by === 'ai')
      }
      return { dom }
    } }
  })
  // off: clear; a new mode: the same scores, highlighted again
  const refresh = () => {
    if (opts.url() || opts.hub()) return last ? show(last) : ask()
    last = null
    view?.dispatch({ effects: setScope.of(Decoration.none) })
  }
  return { extension: [scopeField, plugin, hover], refresh }
}
