// The keys: a few Mod- keys other editors use (never an Alt-letter, nor one
// the browser keeps); for vim, Space as leader (what can follow shows, as
// which-key does), :w :e :q :vs :only :make, and :map that is remembered.
// ? lists them all.
import { Vim, getCM } from '@replit/codemirror-vim'
import { $, el, settings, saveSettings, MOD } from './util.js'
import { view, open } from './editor.js'
import { actions } from './menu.js'

const KEYS = { 'mod+k': 'palette', 'mod+shift+p': 'palette', 'mod+p': 'quick-open', 'mod+s': 'save',
  'mod+alt+m': 'comment', 'mod+backslash': 'toggle-preview', 'mod+j': 'toggle-side', 'mod+shift+e': 'toggle-tree' }
const LEADER = { ' ': 'quick-open', f: 'quick-open', k: 'palette', w: 'save', c: 'comment', i: 'cite',
  e: 'toggle-tree', j: 'toggle-side', p: 'toggle-preview', 1: 'view-editor', 2: 'view-split', 3: 'view-preview',
  z: 'focus', r: 'reset-layout', C: 'comments', d: 'chat', h: 'history', b: 'build', s: 'spelling',
  n: 'new-file', o: 'projects', S: 'share', t: 'theme', '?': 'shortcuts' }
const EDITING = { 'Mod-B, Mod-I': 'bold, italic', 'Mod-Z, Mod-Shift-Z': 'undo, redo', 'Mod-/': 'comment out the line',
  'Mod-F': 'find and replace', 'Mod-D': 'select the next match', 'Alt-↑, Alt-↓': 'move the line',
  'Ctrl-Space': 'complete', 'F8': 'next problem', 'Mod-wheel': 'zoom the preview', 'Esc': 'leave focus' }
const EX = { ':w': 'save', ':e [file]': 'open a file', ':q': 'close the panel, or leave focus',
  ':vs, :only': 'editor and preview, editor only', ':make': 'the build',
  ':imap jk <Esc>': 'any :map, :nmap, :inoremap…, kept until :mapclear' }

const label = a => document.querySelector(`#menubar [data-act="${a}"]`)?.firstChild.textContent.trim() ||
  { 'toggle-preview': 'Show or hide the preview' }[a] || a
const name = k => k.replace('mod', MOD).replace('backslash', '\\').split('+')
  .map(w => w[0].toUpperCase() + w.slice(1)).join('-')
const stop = e => { e.preventDefault(); e.stopPropagation() }
const typing = e => e.target.closest('input, textarea, select, [contenteditable]')
// vim's normal or visual mode, nothing half typed
const normal = e => {
  const v = e.target.closest('.cm-content') && getCM(view)?.state.vim, s = v?.inputState
  return v && !v.insertMode && !s.operator && !s.keyBuffer.length && !s.prefixRepeat.length
}

// Space, then a key; what can follow shows if the key is slow to come
let leading = false, slow
const lead = on => {
  leading = on; clearTimeout(slow); $('leader').hidden = true
  if (on) slow = setTimeout(() => $('leader').hidden = false, 300)
}
$('leader').append(...Object.entries(LEADER).map(([k, a]) =>
  el('div', {}, el('kbd', { textContent: k === ' ' ? 'Space' : k }), label(a))))

// capture: before CodeMirror sees the key; never AltGr (a character there)
document.addEventListener('keydown', e => {
  if (e.getModifierState('AltGraph') || e.target.closest('dialog')) return
  if (leading) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    stop(e); lead(false); return LEADER[e.key] && actions[LEADER[e.key]]()
  }
  if (e.ctrlKey || e.metaKey) {
    const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^(Key|Digit)/, '').toLowerCase()
    const act = KEYS[`mod+${e.altKey ? 'alt+' : ''}${e.shiftKey ? 'shift+' : ''}${k}`]
    if (act) { stop(e); actions[act]() }
  } else if (e.key === ' ' && normal(e)) { stop(e); lead(true) }
  else if (e.key === '?' && !typing(e)) { stop(e); actions.shortcuts() }
}, true)
addEventListener('mousedown', () => leading && lead(false))
// Esc leaves focus, unless the editor wanted it (a suggestion, vim)
document.addEventListener('keydown', e => e.key === 'Escape' && !e.defaultPrevented && settings.focus && actions.focus())

const table = (title, rows) => [el('h4', { textContent: title }), el('dl', {}, ...Object.entries(rows)
  .flatMap(([k, v]) => [el('dt', {}, ...k.split(', ').map(x => el('kbd', { textContent: x }))), el('dd', { textContent: v })]))]
actions.shortcuts = () => {
  $('keys-body').replaceChildren(
    el('section', {}, ...table('Anywhere', Object.fromEntries(Object.entries(KEYS).map(([k, a]) => [name(k), label(a)]))),
      ...table('Editing', Object.fromEntries(Object.entries(EDITING).map(([k, v]) => [k.replaceAll('Mod', MOD), v])))),
    el('section', {}, ...table('Vim: Space, then', Object.fromEntries(Object.entries(LEADER)
      .map(([k, a]) => [k === ' ' ? 'Space' : k, label(a)]))), ...table('Vim: commands', EX)))
  $('keys').showModal()
}

const ex = (cmd, short, f) => Vim.defineEx(cmd, short, (cm, p) => f(p.args?.join(' ') || ''))
ex('write', 'w', () => actions.save())
ex('edit', 'e', f => f ? open(f) : actions['quick-open']())
ex('quit', 'q', () => settings.focus ? actions.focus() : $('side-close').click())
ex('vsplit', 'vs', () => actions['view-split']())
ex('only', 'on', () => actions['view-editor']())
ex('make', 'mak', () => actions.build())
// :map and kin, kept in settings and made again at each start
const MAPS = { map: ['map'], nmap: ['nm', 'normal'], imap: ['im', 'insert'], vmap: ['vm', 'visual'],
  noremap: ['no', , 1], nnoremap: ['nn', 'normal', 1], inoremap: ['ino', 'insert', 1], vnoremap: ['vn', 'visual', 1] }
const map = (cmd, lhs, rhs) => { const [, ctx, nore] = MAPS[cmd]; (nore ? Vim.noremap : Vim.map)(lhs, rhs, ctx) }
for (const [cmd, [short]] of Object.entries(MAPS)) Vim.defineEx(cmd, short, (cm, { args = [] }) => {
  const [lhs, rhs] = args
  if (!rhs) return
  map(cmd, lhs, rhs)
  settings.vimrc = [...(settings.vimrc || []).filter(([c, l]) => c !== cmd || l !== lhs), [cmd, lhs, rhs]]
  saveSettings()
})
Vim.defineEx('mapclear', 'mapc', () => { Vim.mapclear(); settings.vimrc = []; saveSettings() })
for (const m of settings.vimrc || []) map(...m)
