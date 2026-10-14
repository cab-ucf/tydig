// What every button and shortcut does (any element with data-act names an
// action here), and the layout: panes, themes, focus mode, the
// editor|preview divider, and the phone's tab bar.
import { $, settings, saveSettings, theme, system, phone, phoneQ, projName, P, download } from './util.js'
import { MODES } from './surprise.js'
import { signOut, changePassword, deleteAccount } from './auth.js'
import { view, path, undo, restyle, toggleVim, toggleLsp, toggleSpell, toggleScope, scopeBy } from './editor.js'
import { toggleGhost } from './ghost.js'
import { addComment } from './comments.js'
import { exportPdf, exportDocx, fitText, zoom, scheduleCompile } from './preview.js'
import { newFile, uploadTo, quickOpen } from './tree.js'
import { mode, openSidebar, toggleSide, checkpoint, cite } from './panels.js'
import { openPicker, showShare, showGitRemote } from './dialogs.js'

const flip = k => () => { settings[k] = !settings[k]; applyLayout() }
const only = m => () => { settings.max = settings.max === m ? null : m; applyLayout() }
const pane = m => () => openSidebar(m)
const actions = {
  'new-file': () => newFile(), upload: () => uploadTo(), projects: openPicker, 'quick-open': quickOpen,
  save: () => checkpoint('save'), checkpoint: () => checkpoint(), 'export-pdf': exportPdf, 'export-docx': exportDocx,
  'download-src': () => download(`/api${P('/archive')}`, `${projName}-src.tar.gz`),
  'download-all': () => download(`/api${P('/archive?all=1')}`, `${projName}.tar.gz`),
  undo: () => undo.get(path)?.undo(), redo: () => undo.get(path)?.redo(), comment: () => addComment(), cite,
  'toggle-tree': flip('treeOpen'), 'toggle-side': toggleSide,
  'max-editor': only('editor'), 'max-preview': only('preview'),
  focus: () => { flip('focus')(); view?.focus() },
  fullscreen: () => document.fullscreenElement ? document.exitFullscreen()
    : document.documentElement.requestFullscreen(),
  'zoom-in': () => zoom('+'), 'zoom-out': () => zoom('-'), 'zoom-fit': () => zoom('fit'),
  theme: () => { settings.theme = { dark: 'cyber', cyber: 'light', light: 'dark' }[theme()]; applyLayout() },
  comments: pane('comments'), chat: pane('chat'), checklist: pane('checklist'), template: pane('template'),
  history: pane('history'), build: pane('build'), review: pane('review'), spelling: pane('spelling'),
  ghost: toggleGhost, scope: toggleScope, 'scope-next': () => scopeBy(),
  ...Object.fromEntries(Object.keys(MODES).map(by => ['scope-' + by, () => scopeBy(by)])),
  vim: toggleVim, lsp: toggleLsp, spell: toggleSpell, share: showShare, gitremote: showGitRemote,
  signout: signOut, password: changePassword, 'delete-account': deleteAccount,
  shortcuts: () => alert(`Ctrl-P    open file (fuzzy)
Ctrl-S    save: commit, and push to the git remote
Alt-N     new file
Alt-E     export preview PDF
Ctrl-Alt-M  comment on selection
Ctrl-Alt-C  cite: find papers for the selection, check references
Alt-S     spelling and grammar, every file; the cursor on a mark offers fixes
Ctrl-Z / Ctrl-Shift-Z  undo / redo (own edits only)

Alt-1     file tree
Alt-2     side panel
Alt-0     focus: the text alone, centred, no preview
Alt-3     editor only     Alt-4  preview only     Alt-F  full screen
Alt-=  Alt--  Alt-9   zoom preview in / out / fit (or Ctrl-wheel)
drag the bar between editor and preview; double-click it to even out
Alt-C     comments   Alt-M  discussion   Alt-H  history   Alt-B  build
Alt-D     theme: dark, cyberpunk, light

Vim mode: Settings > Vim (then vim keys apply inside the editor)`),
}
// a click on a menu opens it; anything else closes them
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act], .menu > button')
  const menu = b?.matches('.menu > button') ? b.nextElementSibling : null, was = menu?.classList.contains('open')
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'))
  menu ? menu.classList.toggle('open', !was) : b && actions[b.dataset.act]?.()
})
// buttons that act on the selection must not take it away
for (const id of ['pv-comment', 'bar-comment', 'bar-cite']) $(id).onmousedown = e => e.preventDefault()
// capture: before CodeMirror sees the key, so they work while typing
const KEYS = {
  'A-Digit1': 'toggle-tree', 'A-Digit2': 'toggle-side', 'A-Digit0': 'focus', 'A-Digit3': 'max-editor',
  'A-Digit4': 'max-preview', 'A-KeyF': 'fullscreen',
  'A-Equal': 'zoom-in', 'A-Minus': 'zoom-out', 'A-Digit9': 'zoom-fit',
  'A-KeyB': 'build', 'A-KeyH': 'history', 'A-KeyC': 'comments', 'A-KeyM': 'chat',
  'A-KeyN': 'new-file', 'A-KeyS': 'spelling', 'A-KeyE': 'export-pdf', 'A-KeyD': 'theme',
  'C-KeyP': 'quick-open', 'C-KeyS': 'save', 'C-A-KeyM': 'comment', 'C-A-KeyC': 'cite',
}
document.addEventListener('keydown', e => {
  const mods = (e.ctrlKey || e.metaKey ? 'C-' : '') + (e.altKey ? 'A-' : '') + (e.shiftKey ? 'S-' : '')
  const act = KEYS[mods + e.code]
  if (act) { e.preventDefault(); e.stopPropagation(); actions[act]() }
}, true)

export function applyLayout() {
  const b = document.body, on = (c, x) => b.classList.toggle(c, !!x), t = theme()
  b.dataset.m = settings.m
  for (const x of $('mtabs').querySelectorAll('[data-m]')) x.classList.toggle('on', x.dataset.m === settings.m)
  on('no-tree', !settings.treeOpen); on('focus', settings.focus)
  on('max-editor', settings.max === 'editor'); on('max-preview', settings.max === 'preview')
  document.querySelectorAll('.sect-head').forEach(h => {
    h.parentNode.classList.toggle('closed', !settings[h.dataset.sect])
    h.firstElementChild.textContent = settings[h.dataset.sect] ? '▾' : '▸'
  })
  $('side').hidden = !settings.sideOpen // hidden in the markup, so it does not flash before this
  $('scope').hidden = !settings.scope
  document.documentElement.dataset.theme = t; on('dark-preview', t !== 'light'); restyle()
  $('page').style.width = settings.zoom ? `${Math.round(820 * settings.zoom)}px` : '100%'
  fitText()
  $('editor').style.flex = `${settings.split} 1 0`; $('preview').style.flex = `${1 - settings.split} 1 0`
  for (const x of document.querySelectorAll('[data-check]')) {
    const k = x.dataset.check
    x.classList.toggle('checked', k.startsWith('scope-') ? settings.scope?.by === k.slice(6) : !!settings[k])
  }
  saveSettings()
}
system.addEventListener('change', applyLayout)
for (const h of document.querySelectorAll('.sect-head'))
  h.onclick = e => e.target.closest('button') || flip(h.dataset.sect)()

// The divider: drag it; double-click to even it out.
const split = $('split')
split.onpointerdown = e => {
  const left = $('editor').getBoundingClientRect().left, total = $('editor').offsetWidth + $('preview').offsetWidth
  split.setPointerCapture(e.pointerId)
  split.onpointermove = m => {
    settings.split = Math.min(0.9, Math.max(0.1, (m.clientX - left) / total)); applyLayout()
  }
  split.onpointerup = () => split.onpointermove = null
}
split.ondblclick = () => { settings.split = 0.5; applyLayout() }

// Phones show one pane at a time, picked in the bottom tab bar; what their bar
// has no room for moves: which file to compile above the preview, the word
// count under the Edit tab, build into the tab bar.
// (iOS zooms into a field under 16px when tapped; maximum-scale stops it.)
if (/iP(hone|ad|od)/.test(navigator.userAgent))
  document.querySelector('meta[name=viewport]').content += ', maximum-scale=1'
const moves = [['main-label', 'zoomctl', 'prepend'], ['wordcount', 'mt-edit', 'append'],
  ['bar-build', 'mtabs', 'append']].map(([id, to, how]) => [$(id), $(id).parentNode, $(id).nextSibling, $(to), how])
const place = () => moves.forEach(([e, home, next, to, how]) => phone() ? to[how](e) : home.insertBefore(e, next))
phoneQ.addEventListener('change', place); place()
phoneQ.addEventListener('change', applyLayout)
$('mtabs').onclick = e => {
  const m = e.target.closest('[data-m]')?.dataset.m
  if (m === 'side') return openSidebar(mode || 'chat')
  if (!m) return
  settings.m = m; applyLayout()
  if (m === 'preview') scheduleCompile()
}
