// What every button and key does (any element with data-act names an
// action here; keys.js binds the keys), and the layout: panes, themes, focus mode, the
// editor|preview divider, and the phone's tab bar.
import { $, settings, LAYOUT, saveSettings, theme, phone, phoneQ, projName, P, download, MOD, choose }
  from './util.js'
import { MODES } from './surprise.js'
import { signOut, changeName, changePassword, deleteAccount } from './auth.js'
import { view, path, undo, restyle, toggleVim, toggleLsp, toggleSpell, toggleScope, scopeBy } from './editor.js'
import { toggleGhost } from './ghost.js'
import { addComment, discuss } from './comments.js'
import { exportPdf, exportDocx, fitText, zoom, scheduleCompile } from './preview.js'
import { newFile, uploadTo, quickOpen, grep, tagMenu } from './tree.js'
import { tags } from './doc.js'
import { mode, openSidebar, toggleSide, checkpoint, cite, citeFromBib } from './panels.js'
import { toggleComment } from '@codemirror/commands'
import { openPicker, showShare, showGitRemote } from './dialogs.js'

const flip = k => () => { settings[k] = !settings[k]; applyLayout() }
const show = v => () => { settings.view = v; applyLayout() }
const pane = m => () => openSidebar(m)
export const actions = {
  'new-file': () => newFile(), upload: () => uploadTo(), projects: openPicker, 'quick-open': quickOpen,
  grep: () => grep(view?.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), // a selection, searched for as it is
  save: () => checkpoint('save'), checkpoint: () => checkpoint(), 'export-pdf': exportPdf, 'export-docx': exportDocx,
  'download-src': () => download(`/api${P('/archive')}`, `${projName}-src.tar.gz`),
  'download-all': () => download(`/api${P('/archive?all=1')}`, `${projName}.tar.gz`),
  undo: () => tags(path)['read-only'] || undo.get(path)?.undo(), redo: () => tags(path)['read-only'] || undo.get(path)?.redo(), comment: () => addComment(), cite: () => cite(),
  'toggle-tree': flip('treeOpen'), 'toggle-side': toggleSide,
  'view-editor': show('editor'), 'view-split': show('split'), 'view-preview': show('preview'),
  'toggle-preview': () => show(settings.view === 'split' ? 'editor' : 'split')(),
  'reset-layout': () => { Object.assign(settings, LAYOUT); applyLayout() },
  close: () => settings.focus ? actions.focus() : $('side-close').click(),
  'line-comment': () => view && toggleComment(view), 'cite-bib': citeFromBib, 'cite-alone': () => cite(true),
  focus: () => { flip('focus')(); view?.focus() },
  fullscreen: () => document.fullscreenElement ? document.exitFullscreen()
    : document.documentElement.requestFullscreen(),
  'zoom-in': () => zoom('+'), 'zoom-out': () => zoom('-'), 'zoom-fit': () => zoom('fit'),
  theme: () => { settings.theme = { dark: 'cyber', cyber: 'light', light: 'dark' }[theme()]; applyLayout() },
  discuss, comments: pane('comments'), chat: pane('chat'), checklist: pane('checklist'), template: pane('template'),
  tags: () => path && tagMenu(path), history: pane('history'), build: pane('build'), review: pane('review'), spelling: pane('spelling'), aicheck: pane('aicheck'),
  ghost: toggleGhost, scope: toggleScope, 'scope-next': () => scopeBy(),
  ...Object.fromEntries(Object.keys(MODES).map(by => ['scope-' + by, () => scopeBy(by)])),
  vim: toggleVim, lsp: toggleLsp, spell: toggleSpell, share: showShare, gitremote: showGitRemote,
  signout: signOut, name: changeName, password: changePassword, 'delete-account': deleteAccount,
  palette: () => choose([...document.querySelectorAll('#menubar [data-act]')].map(b => ({
    label: b.firstChild.textContent.trim(), hint: b.querySelector('kbd')?.textContent,
    run: () => actions[b.dataset.act]() })), 'find a command...'),
}
for (const k of document.querySelectorAll('kbd')) k.textContent = k.textContent.replaceAll('Mod', MOD)
for (const k of document.querySelectorAll('[title*="Mod-"]')) k.title = k.title.replaceAll('Mod', MOD)
// a click on a menu opens it; anything else closes them
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act], .menu > button')
  const menu = b?.matches('.menu > button') ? b.nextElementSibling : null, was = menu?.classList.contains('open')
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'))
  menu ? menu.classList.toggle('open', !was) : b && actions[b.dataset.act]?.()
})
// buttons that act on the selection must not take it away
for (const id of ['pv-comment', 'bar-comment', 'bar-cite']) $(id).onmousedown = e => e.preventDefault()

export function applyLayout() {
  const b = document.body, on = (c, x) => b.classList.toggle(c, !!x), t = theme()
  b.dataset.m = settings.m; b.dataset.view = settings.view
  for (const x of $('mtabs').querySelectorAll('[data-m]')) x.classList.toggle('on', x.dataset.m === settings.m)
  on('no-tree', !settings.treeOpen); on('focus', settings.focus)
  document.querySelectorAll('.sect-head').forEach(h => {
    h.parentNode.classList.toggle('closed', !settings[h.dataset.sect])
    h.firstElementChild.textContent = settings[h.dataset.sect] ? '▾' : '▸'
  })
  $('side').hidden = !settings.sideOpen // hidden in the markup, so it does not flash before this
  $('scope').hidden = !settings.scope; $('bar-ai').hidden = !settings.scope
  document.documentElement.dataset.theme = t; on('dark-preview', t !== 'light'); restyle()
  $('page').style.width = settings.zoom ? `${Math.round(820 * settings.zoom)}px` : '100%'
  $('zoom-pct').textContent = settings.zoom ? `${Math.round(100 * settings.zoom)}%` : 'Fit'
  fitText()
  split()
  for (const x of document.querySelectorAll('[data-check]')) {
    const k = x.dataset.check
    const [key, is] = k.split('='), on = k.startsWith('scope-') ? settings.scope?.by === k.slice(6)
      : is ? settings[key] === is : !!settings[key]
    x.classList.toggle('checked', on); x.setAttribute('aria-pressed', on)
  }
  saveSettings()
}
for (const h of document.querySelectorAll('.sect-head'))
  h.onclick = e => e.target.closest('button') || flip(h.dataset.sect)()

// The divider: drag it (only the panes move; the rest of the layout, once
// let go); double-click to even it out.
function split() { $('editor').style.flex = `${settings.split} 1 0`; $('preview').style.flex = `${1 - settings.split} 1 0` }
const bar = $('split')
bar.onpointerdown = e => {
  const left = $('editor').getBoundingClientRect().left, total = $('editor').offsetWidth + $('preview').offsetWidth
  bar.setPointerCapture(e.pointerId)
  bar.onpointermove = m => { settings.split = Math.min(0.8, Math.max(0.2, (m.clientX - left) / total)); split() }
  bar.onlostpointercapture = () => { bar.onpointermove = null; applyLayout() } // let go, or cancelled
}
bar.ondblclick = () => { settings.split = 0.5; applyLayout() }

// Phones show one pane at a time, picked in the bottom tab bar; what their bar
// has no room for moves: the word count under the Edit tab, build into the
// tab bar.
// (iOS zooms into a field under 16px when tapped; maximum-scale stops it.)
if (/iP(hone|ad|od)/.test(navigator.userAgent))
  document.querySelector('meta[name=viewport]').content += ', maximum-scale=1'
const moves = [['wordcount', 'mt-edit', 'append'],
  ['bar-build', 'mtabs', 'append']].map(([id, to, how]) => [$(id), $(id).parentNode, $(id).nextSibling, $(to), how])
const place = () => moves.forEach(([e, home, next, to, how]) => phone() ? to[how](e) : home.insertBefore(e, next))
phoneQ.addEventListener('change', place); place()
phoneQ.addEventListener('change', applyLayout)
$('mtabs').onclick = e => {
  const m = e.target.closest('[data-m]')?.dataset.m
  if (m === 'side') return mode ? openSidebar(mode) : discuss()
  if (!m) return
  settings.m = m; applyLayout()
  if (m === 'preview') scheduleCompile()
}
