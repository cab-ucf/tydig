// Ghost text: a model proposes how the sentence goes on, in grey after the
// cursor; Tab takes it, typing or moving dismisses it. The hub's model when it
// serves one, else one on this person's own machine through Ollama.
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { Prec, StateField, StateEffect } from '@codemirror/state'
import { el, settings, assist, toast, esc, P } from './util.js'
import { applyLayout } from './menu.js'

const set = StateEffect.define()
class Ghost extends WidgetType {
  constructor(text) { super(); this.text = text }
  toDOM() { return el('span', { className: 'cm-ghost', textContent: this.text }) }
}
const field = StateField.define({
  create: () => null,
  update: (g, tr) => {
    const e = tr.effects.find(e => e.is(set))
    return e ? e.value : tr.docChanged || tr.selection ? null : g
  },
  provide: f => EditorView.decorations.from(f, g => !g ? Decoration.none
    : Decoration.set([Decoration.widget({ widget: new Ghost(g.text), side: 1 }).range(g.pos)])),
})

// Fill-in-the-middle where the model can; otherwise raw, so a chat model
// continues the text rather than answering it; a thinking model not to think.
const noFim = new Set(), said = new Set()
const generate = async (prompt, suffix) => {
  const g = settings.ghost, r = g.hub
    ? await fetch(`/api${P('/ghost')}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, suffix }) }) // the hub's model, which sets the rest itself
    : await fetch(`${g.url}/api/generate`, { method: 'POST', body: JSON.stringify({ model: g.model, prompt,
      ...suffix != null ? { suffix } : { raw: true }, think: false, stream: false, keep_alive: '30m',
      options: { temperature: 0.2, num_predict: 40, stop: ['\n'] } }) })
  return { ok: r.ok, status: r.status, ...await r.json().catch(() => ({})) }
}
// Ollama refusing this page's origin looks, from here, like no Ollama at all
const failed = (r, { hub, url }, o = location.origin) => r.status
  ? `${hub ? 'The hub\'s model' : 'Ollama'}: ${esc(r.error || `error ${r.status}`)}`
  : hub ? 'The hub did not answer for ghost text.' : `No answer from Ollama at ${esc(url)}. If it is
    running, it refuses this page: set <code>OLLAMA_ORIGINS=${o}</code> in Ollama's own environment
    (Linux service: <code>systemctl edit ollama</code>, add <code>Environment="OLLAMA_ORIGINS=${o}"</code>;
    Mac: <code>launchctl setenv OLLAMA_ORIGINS ${o}</code>), then restart Ollama.`
const say = m => said.has(m) || (said.add(m), toast(m, false, 15000))

// One question at a time, never cancelled by typing: a slow model's answer
// still lands if what was typed meanwhile is how it begins.
const plugin = ViewPlugin.fromClass(class {
  update(u) {
    if (!settings.ghost || !u.docChanged || !u.transactions.some(t => t.isUserEvent('input'))) return
    clearTimeout(this.t); this.t = setTimeout(() => this.suggest(u.view), 600)
  }
  async suggest(v) {
    const { head, empty } = v.state.selection.main, doc = v.state.doc, key = settings.ghost.model ?? 'hub'
    if (!empty || this.busy) return
    this.busy = true; v.dispatch({ effects: set.of({ pos: head, text: '…', wait: true }) })
    const ask = fim => generate(doc.sliceString(Math.max(0, head - 2000), head),
      fim ? doc.sliceString(head, head + 800) : undefined).catch(() => ({ status: 0 }))
    let r = await ask(!noFim.has(key))
    if (r.status === 400 && /insert|suffix/i.test(r.error)) { noFim.add(key); r = await ask(false) }
    this.busy = false
    if (v.state.field(field, false)?.wait) v.dispatch({ effects: set.of(null) })
    if (!r.ok) return r.status === 409 || say(failed(r, settings.ghost))
    // the rest of this sentence, past what was typed while the model thought,
    // less any text before it that a small model may say back first
    const before = doc.sliceString(Math.max(0, head - 400), head), out = r.response || ''
    const echo = [...Array(Math.min(out.length, before.length) + 1).keys()].reverse()
      .find(k => k >= 8 && before.endsWith(out.slice(0, k))) || 0
    const text = /^[\s\S]*?(?:[.!?](?=\s|$)|$)/.exec(out.slice(echo))[0].replace(/\s+$/, '')
    const now = v.state.selection.main.head, typed = now >= head ? v.state.doc.sliceString(head, now) : null
    if (text.trim().length >= 20 && before.includes(text.trim())) return // a sentence from above, again
    if (typed != null && text.length > typed.length && text.startsWith(typed))
      v.dispatch({ effects: set.of({ pos: now, text: text.slice(typed.length) }) })
    else if (typed) this.suggest(v) // it went elsewhere: ask about where the text is now
  }
})
const take = v => {
  const g = v.state.field(field, false)
  if (!g || g.wait) return false
  v.dispatch({ changes: { from: g.pos, insert: g.text }, selection: { anchor: g.pos + g.text.length } })
  return true
}
const drop = v => !!v.state.field(field, false) && (v.dispatch({ effects: set.of(null) }), true)
const keys = Prec.highest(keymap.of([{ key: 'Tab', run: take }, { key: 'Escape', run: drop }]))
export const ghost = [field, plugin, keys]

export async function toggleGhost() {
  if ((await assist).ghost) settings.ghost = settings.ghost ? null : { hub: true }
  else {
    const model = prompt('Ghost suggestions from a model on your own computer, through Ollama (ollama.com). ' +
      'Model to use (e.g. qwen2.5-coder:1.5b), or empty to turn them off. Ollama must allow this page: ' +
      `OLLAMA_ORIGINS=${location.origin}`, settings.ghost?.model || 'qwen2.5-coder:1.5b')
    if (model == null) return
    const url = settings.ghost?.url || 'http://localhost:11434'
    settings.ghost = model.trim() ? { url, model: model.trim() } : null
  }
  applyLayout()
}
