// The keys: a few Mod- keys other editors use (never an Alt-letter, nor one
// the browser keeps); for vim, Space as leader (what can follow shows, as
// which-key does), :w :e :q :vs :only :make, and :map that is remembered.
// Esc is vim's: with vim keys, Space z, :q or the corner button leave focus.
// ? lists them all.
import { $, el, settings, saveSettings, MOD } from './util.js'
import { view, open, onVim } from './editor.js'
import { actions } from './menu.js'

const KEYS = { 'mod+k': 'palette', 'mod+shift+p': 'palette', 'mod+p': 'quick-open', 'mod+s': 'save',
  'mod+alt+m': 'comment', 'mod+backslash': 'toggle-preview', 'mod+j': 'toggle-side', 'mod+shift+e': 'toggle-tree' }
// after AstroNvim's leader: w save, q quit, n new, e explorer, / comment a
// line, f find, g git, u UI; tydig's own: c comment, r references, views
const LEADER = { ' ': 'quick-open', w: 'save', q: 'close', n: 'new-file', e: 'toggle-tree', '/': 'line-comment',
  c: 'comment', C: 'comments', d: 'chat', b: 'build', z: 'focus', p: 'toggle-preview', j: 'toggle-side',
  1: 'view-editor', 2: 'view-split', 3: 'view-preview', '?': 'shortcuts',
  f: { name: 'Find', f: 'quick-open', c: 'palette', k: 'shortcuts', p: 'projects', r: 'cite-bib', t: 'theme' },
  r: { name: 'References', r: 'cite-bib', c: 'cite', a: 'cite-alone', s: 'spelling', i: 'aicheck' },
  g: { name: 'Git', c: 'history', s: 'checkpoint', r: 'gitremote', S: 'share' },
  u: { name: 'UI', r: 'reset-layout', f: 'fullscreen', t: 'theme', s: 'spell', g: 'ghost', l: 'lsp', o: 'scope', v: 'vim' } }
const EDITING = { 'Mod-B, Mod-I': 'bold, italic', 'Mod-Z, Mod-Shift-Z': 'undo, redo', 'Mod-/': 'comment out the line',
  'Mod-F': 'find and replace', 'Mod-D': 'select the next match', 'Alt-↑, Alt-↓': 'move the line',
  'Ctrl-Space': 'complete', 'F8': 'next problem', 'Mod-wheel': 'zoom the preview', 'Esc': 'leave focus (vim: Space z)' }
const EX = { ':w': 'save', ':e [file]': 'open a file', ':q': 'close the panel, or leave focus',
  ':vs, :only': 'editor and preview, editor only', ':make': 'the build',
  ':imap jk <Esc>': 'any :map, :nmap, :inoremap…, kept until :mapclear' }

const label = a => document.querySelector(`#menubar [data-act="${a}"]`)?.firstChild.textContent.trim() ||
  { 'toggle-preview': 'Show or hide the preview', close: 'Close the panel, or leave focus',
    'line-comment': 'Comment out the line' }[a] || a
const name = k => k.replace('mod', MOD).replace('backslash', '\\').split('+')
  .map(w => w[0].toUpperCase() + w.slice(1)).join('-')
const stop = e => { e.preventDefault(); e.stopPropagation() }
const typing = e => e.target.closest('input, textarea, select, [contenteditable]')
// vim's normal or visual mode, nothing half typed
const normal = e => {
  const v = e.target.closest('.cm-content') && view?.cm?.state.vim, s = v?.inputState
  return v && !v.insertMode && !s.operator && !s.keyBuffer.length && !s.prefixRepeat.length
}

// Space, then a key or a group's keys; what can follow shows if the next is slow to come
const keyName = k => k === ' ' ? 'Space' : k, keysOf = n => Object.entries(n).filter(([k]) => k !== 'name')
let node = null, slow
const lead = n => {
  node = n; clearTimeout(slow); $('leader').hidden = true
  if (!n) return
  $('leader').replaceChildren(...keysOf(n).map(([k, a]) => el('div', { className: a.name ? 'group' : '' },
    el('kbd', { textContent: keyName(k) }), a.name ? `+${a.name}` : label(a))))
  slow = setTimeout(() => $('leader').hidden = false, n === LEADER ? 300 : 0)
}

// capture: before CodeMirror sees the key; never AltGr (a character there)
document.addEventListener('keydown', e => {
  if (e.getModifierState('AltGraph') || e.target.closest('dialog')) return
  if (node) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    const a = node[e.key]; stop(e)
    return a?.name ? lead(a) : (lead(null), a && actions[a]())
  }
  if (e.ctrlKey || e.metaKey) {
    const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^(Key|Digit)/, '').toLowerCase()
    const act = KEYS[`mod+${e.altKey ? 'alt+' : ''}${e.shiftKey ? 'shift+' : ''}${k}`]
    if (act) { stop(e); actions[act]() }
  } else if (e.key === ' ' && normal(e)) { stop(e); lead(LEADER) }
  else if (e.key === '?' && !typing(e)) { stop(e); actions.shortcuts() }
}, true)
addEventListener('mousedown', () => node && lead(null))
// Esc leaves focus, unless the editor wanted it (a suggestion), or vim has it
document.addEventListener('keydown', e => e.key === 'Escape' && !e.defaultPrevented && !settings.vim &&
  settings.focus && actions.focus())

const flat = (n, pre) => keysOf(n).flatMap(([k, a]) => a.name ? flat(a, `${pre}${k} `) : [[pre + keyName(k), label(a)]])
const table = (title, rows) => [el('h4', { textContent: title }), el('dl', {}, ...Object.entries(rows)
  .flatMap(([k, v]) => [el('dt', {}, ...k.split(', ').map(x => el('kbd', { textContent: x }))), el('dd', { textContent: v })]))]
actions.shortcuts = () => {
  $('keys-body').replaceChildren(
    el('section', {}, ...table('Anywhere', Object.fromEntries(Object.entries(KEYS).map(([k, a]) => [name(k), label(a)]))),
      ...table('Editing', Object.fromEntries(Object.entries(EDITING).map(([k, v]) => [k.replaceAll('Mod', MOD), v])))),
    el('section', {}, ...table('Vim: Space, then', Object.fromEntries(flat(LEADER, ''))), ...table('Vim: commands', EX)))
  $('keys').showModal()
}

onVim.push(Vim => {
  const ex = (cmd, short, f) => Vim.defineEx(cmd, short, (cm, p) => f(p.args?.join(' ') || ''))
  ex('write', 'w', () => actions.save())
  ex('edit', 'e', f => f ? open(f) : actions['quick-open']())
  ex('quit', 'q', () => actions.close())
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
})
