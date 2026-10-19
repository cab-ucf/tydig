// The editor: CodeMirror on a file's shared text, with its syntax, the theme,
// tinymist (LSP), spelling, comments, ghost text and the surprise overlay. A file that
// is not shared text opens read-only, as an image, or is downloaded.
import { basicSetup } from 'codemirror'
import { EditorView, ViewPlugin, keymap } from '@codemirror/view'
import { EditorState, EditorSelection, Compartment, Prec, Annotation } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting, LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { indentWithTab } from '@codemirror/commands'
import { tags as t } from '@lezer/highlight'
import * as Y from 'yjs'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { typst } from 'codemirror-lang-typst'
import { surprise, aiText, aiAbout, MODES, prose } from './surprise.js'
import { spellcheck } from './spell.js'
import { $, el, api, assist, settings, theme, projName, P, rawUrl, saveAs, asText } from './util.js'
import { files, provider, token, ws, isImg, okPath, GEN, tags, onTags, TAGS } from './doc.js'
import { ghost } from './ghost.js'
import { commentExt } from './comments.js'
import { renderTree } from './tree.js'
import { applyLayout } from './menu.js'
import { later } from './warm.js'

export let view = null, path = null, prev = null // prev: the file before, for vim's Ctrl-^
export const undo = new Map() // path -> Y.UndoManager: own edits only
// vim, loaded only when wanted; who needs its Vim (keys.js) hears when it is
export const onVim = []
let vimMod, Vm
const vimExt = async () => { vimMod ??= import('@replit/codemirror-vim').then(m => (Vm = m, onVim.forEach(f => f(m.Vim)), m))
  return (await vimMod).vim({ status: true }) }
const vimC = new Compartment(), themeC = new Compartment(), spellC = new Compartment(), lspC = new Compartment()

// Syntax colours for the dark themes; light keeps CodeMirror's own.
const palette = c => Prec.high(syntaxHighlighting(HighlightStyle.define([
  { tag: t.heading, color: c.head, fontWeight: 'bold' },
  { tag: [t.strong, t.emphasis], color: c.text, fontWeight: 'bold' },
  { tag: t.emphasis, color: c.text, fontStyle: 'italic', fontWeight: 'normal' },
  { tag: t.keyword, color: c.key },
  { tag: t.string, color: c.str },
  { tag: [t.number, t.labelName, t.tagName], color: c.num },
  { tag: [t.comment, t.lineComment, t.blockComment], color: c.com, fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.fn },
  { tag: t.variableName, color: c.text },
  { tag: [t.operator, t.punctuation, t.bracket, t.processingInstruction, t.macroName], color: c.op },
  { tag: [t.link, t.url], color: c.head, textDecoration: 'underline' },
  { tag: t.monospace, color: c.mono },
])))
const PALETTES = {
  dark: palette({ head: '#5ec5d4', text: '#f2f2f2', key: '#c792ea', str: '#a5d6a7', num: '#f3a96a',
    com: '#9aa3ad', fn: '#82aaff', op: '#7fd1de', mono: '#cba6f7' }),
  cyber: palette({ head: '#ff2bd6', text: '#f7ecff', key: '#c77dff', str: '#00f5d4', num: '#ffd23f',
    com: '#a083c4', fn: '#ff71ce', op: '#b967ff', mono: '#ff9de2' }),
}
const dark = EditorView.theme({}, { dark: true })
const themeExt = () => PALETTES[theme()] ? [PALETTES[theme()], dark] : []
export function restyle() { view?.dispatch({ effects: themeC.reconfigure(themeExt()) }) }
export async function toggleVim() {
  settings.vim = !settings.vim; applyLayout()
  view?.dispatch({ effects: vimC.reconfigure(settings.vim ? await vimExt() : []) })
}

// spelling and grammar (spell.js), in .typ files
const spellExt = p => settings.spell && p?.endsWith('.typ') ? spellcheck(files) : []
export function toggleSpell() {
  settings.spell = !settings.spell; applyLayout()
  view?.dispatch({ effects: spellC.reconfigure(spellExt(path)) })
}

// Syntax for any file, by name (loaded on demand).
const langFor = async p => p.endsWith('.typ') ? typst() : await LanguageDescription
  .matchFilename(languages, p.replace(/Containerfile$/, 'Dockerfile'))?.load() ?? []

// tinymist, through the hub; off (until toggled) once its socket closes,
// and nothing is sent down a closed one
let tinymist = null, lspDead = false
async function lspExt(p) {
  if (!settings.lsp || lspDead || !p.endsWith('.typ')) return []
  let mine // this client, so an older one's closing never marks it dead
  const gone = () => { if (tinymist === mine) { lspDead = true; tinymist = null } }
  const { LanguageServerClient, WebSocketTransport, languageServerWithTransport: lspExtension } =
    await import('codemirror-languageserver')
  class Socket extends WebSocketTransport { send(m) { this.connection.readyState === 1 && super.send(m) } }
  mine = tinymist ??= api(P('/info')).then(({ root }) => ({ root, client: new LanguageServerClient({
    transport: new Socket(`${ws}/lsp?proj=${projName}&t=${encodeURIComponent(token())}`),
    rootUri: `file://${root}`, workspaceFolders: [{ name: projName, uri: `file://${root}` }],
    autoClose: false, onError: gone, onClose: gone,
  }) }))
  try {
    const { root, client } = await tinymist
    return lspExtension({ client, documentUri: `file://${root}/${p}`, languageId: 'typst' })
  } catch { gone(); return [] }
}
export function toggleLsp() {
  const old = tinymist; tinymist = null
  old?.then(({ client }) => client.close(), () => {}) // the hub allows a person two sockets
  settings.lsp = !settings.lsp; lspDead = false; applyLayout()
  if (path) openFile(path)
}

let counting
const countWords = () => { // the prose, not the markup
  const src = path?.endsWith('.typ') && view?.state.doc.toString()
  $('wordcount').textContent = src ? `${(prose(src).text.match(/[\p{L}\p{N}']+/gu) || []).length} words` : ''
}
const show = (state, ...dom) => {
  view?.destroy()
  $('cm').replaceChildren(...dom); $('filepath').textContent = path || ''
  view = state && new EditorView({ state, parent: $('cm') })
  countWords(); renderTree(); fileTags()
}
// the open file's tags, over the editor
const fileTags = () => $('filetags').replaceChildren(...Object.keys(path ? tags(path) : {}).map(k =>
  el('span', { className: 'ftag ' + k, textContent: TAGS[k], title: k === 'read-only'
    ? 'A reference: not edited here. The tree (tag) or the Edit menu makes it editable.' : 'Written by AI' })))
// a file made read-only, or editable, opens again as it now is
let wasRo = false
onTags(() => { fileTags(); renderTree()
  if (path && files.has(path) && !!tags(path)['read-only'] !== wasRo) openFile(path) })

// A read-only file: shown, not bound for editing. The shared text's changes
// come in; nothing from here (typing, ghost text, a fix, a citation) goes out.
const synced = Annotation.define()
const follow = yt => [EditorState.readOnly.of(true), EditorState.changeFilter.of(tr => !!tr.annotation(synced)),
  ViewPlugin.define(v => {
    const f = e => { // Yjs's delta, as CodeMirror's changes to the text before it
      const changes = []; let at = 0
      for (const d of e.delta) {
        if (d.retain) at += d.retain
        else if (d.insert) changes.push({ from: at, insert: d.insert })
        else if (d.delete) changes.push({ from: at, to: at += d.delete })
      }
      v.dispatch({ changes, annotations: synced.of(true) })
    }
    yt.observe(f)
    return { destroy: () => yt.unobserve(f) }
  })]

// Mod-B, Mod-I: *bold*, _italic_ around the selection (or at the cursor)
const wrap = m => v => (v.dispatch(v.state.changeByRange(r => ({ range: EditorSelection.range(r.from + 1, r.to + 1),
  changes: [{ from: r.from, insert: m }, { from: r.to, insert: m }] }))), true)
const emphasis = Prec.high(keymap.of([{ key: 'Mod-b', run: wrap('*') }, { key: 'Mod-i', run: wrap('_') }]))

let opening = 0
export async function openFile(p) {
  const yt = files.get(p)
  if (!yt) return
  const my = ++opening, [lang, vimKeys] = await Promise.all([langFor(p), settings.vim ? vimExt() : []])
  if (my !== opening) return // another file was opened meanwhile
  if (p !== path) prev = path
  path = p; wasRo = !!tags(p)['read-only']
  if (!undo.has(p)) undo.set(p, new Y.UndoManager(yt))
  show(EditorState.create({ doc: yt.toString(), extensions: [
    vimC.of(vimKeys), basicSetup, themeC.of(themeExt()), lang, lspC.of([]), spellC.of(spellExt(p)),
    keymap.of([indentWithTab, ...wasRo ? [] : yUndoManagerKeymap]), p.endsWith('.typ') ? emphasis : [],
    wasRo ? follow(yt) : yCollab(yt, provider.awareness, { undoManager: undo.get(p) }),
    commentExt, ghost, scope.extension, EditorView.lineWrapping,
    EditorView.updateListener.of(u => u.docChanged && (clearTimeout(counting), counting = setTimeout(countWords, 300))),
  ] }))
  provider.setAwarenessField('file', p)
  localStorage['last:' + projName] = p
  // tinymist joins once the preview is up, if this file is still open
  later.then(() => lspExt(p)).then(ext => my === opening && view?.dispatch({ effects: lspC.reconfigure(ext) }))
}

// Files outside the CRDT: build output as read-only text, an image as itself,
// a PDF in a tab; anything else is downloaded. (Never a blob: page: an
// uploaded .svg or .html would run in this origin.)
async function openDisk(p) {
  const my = ++opening, r = await fetch(rawUrl(p))
  if (!r.ok) return alert(`${p}: ${r.status}`)
  const blob = await r.blob(), text = isImg(p) ? null : await asText(blob), pdf = /\.pdf$/i.test(p)
  if (my !== opening) return
  // text that reached the disk some other way (a shell, git, an older hub) joins the CRDT
  if (text != null && okPath(p) && !GEN.test(p)) { files.set(p, new Y.Text(text)); return openFile(p) }
  if (pdf || text == null && !isImg(p))
    return saveAs(blob, p, pdf ? 'application/pdf' : 'application/octet-stream')
  const lang = text != null && await langFor(p)
  if (my !== opening) return
  path = p
  if (text != null) return show(EditorState.create({ doc: text, extensions: [
    basicSetup, themeC.of(themeExt()), lang, EditorView.lineWrapping, EditorState.readOnly.of(true)] }))
  const img = el('img', { className: 'disk-img', alt: p, onload: () => URL.revokeObjectURL(img.src),
    src: URL.createObjectURL(new Blob([blob], { type: /\.svg$/i.test(p) ? 'image/svg+xml' : blob.type })) })
  show(null, img)
}
export function open(p) { return files.has(p) ? openFile(p) : openDisk(p) }
// a file, with from..to selected
export async function reveal(p, from, to) {
  if (path !== p) await openFile(p)
  if (path !== p || !view || to > view.state.doc.length) return // gone, renamed, or overtaken
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); view?.focus()
}

// The surprise overlay (surprise.js): words tinted by how much they surprise
// a model, from the hub's Perplexiscope engine or one on this machine.
const modes = Object.keys(MODES)
const nextMode = () => modes[(modes.indexOf(settings.scope?.by) + 1) % modes.length]
const scope = surprise({
  url: () => settings.scope?.url, hub: () => settings.scope?.hub && `/api${P('/surprise')}`,
  by: () => settings.scope?.by, typst: () => !!path?.endsWith('.typ'), after: later,
  // while a reading is awaited, a bar sweeps the editor's header
  busy: on => { $('editor').classList.toggle('scope-busy', on); $('scope').classList.toggle('busy', on) },
  // in vim, typing is read on the way out of insert mode
  hold: () => { const cm = settings.vim && Vm?.getCM(view)
    cm && !cm.scoped && (cm.scoped = cm.on('vim-mode-change', () => scope.poke()) ?? 1)
    return !!cm?.state?.vim?.insertMode },
  report: r => {
    const b = $('scope')
    b.hidden = !settings.scope
    if (r.error === 'replaced by a newer ask') return
    const [name, what] = MODES[settings.scope?.by] || MODES.bits, ppl = r.ppl?.toFixed(1)
    b.textContent = r.error ? 'surprise: unavailable' : `${name} · ppl ${ppl} · ${aiText(r.ai)}`
    b.title = r.error || `Highlighting ${name}: ${what}. Click for ${MODES[nextMode()][0]}.\nThis file ` +
      `reads at perplexity ${ppl} (${r.bpt.toFixed(2)} bits a token). ${aiAbout(r.ai)} ` +
      'Hover a word for its numbers.'
  },
})
export async function toggleScope() {
  if ((await assist).surprise) settings.scope = settings.scope ? null : { hub: true, by: 'bits' }
  else {
    const url = prompt('Show how surprising each word is to a language model, and how AI-like each ' +
      'sentence reads, from a Perplexiscope engine on your computer (run `just` in its folder). ' +
      'Its address, or empty to turn this off:', settings.scope?.url || 'http://localhost:8000')
    if (url == null) return
    settings.scope = url.trim() ? { url: url.trim(), by: settings.scope?.by || 'bits' } : null
  }
  applyLayout(); scope.refresh()
}
// highlight by surprise, flatness or AI-likeness (no mode: the next one)
export async function scopeBy(by = nextMode()) {
  if (!settings.scope) await toggleScope()
  if (settings.scope) { settings.scope.by = by; applyLayout(); scope.refresh() }
}
