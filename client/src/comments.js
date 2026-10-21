// Comments: anchored to text so they move with edits; made from a selection in
// the editor or the preview; highlighted, shown on hover, numbered in their
// pane and pinned in the preview. And the Discussion: the project's chat.
import * as Y from 'yjs'
import { Annotation, StateField } from '@codemirror/state'
import { Decoration, ViewPlugin, hoverTooltip, showTooltip } from '@codemirror/view'
import { $, el, esc, dot, uid, toast, settings, projName, icon, phone } from './util.js'
import { ydoc, files, comments, chat, user } from './doc.js'
import { view, path, reveal } from './editor.js'
import { openSidebar, redraw, mode, tabs, citeBubble } from './panels.js'
import { pinSafe } from './preview.js'
import { toSource, toPreview } from './align.js'
import { applyLayout } from './menu.js'

// an anchor's start sticks to the text after it, its end to the text before:
// typing at either edge never stretches a comment
const b64 = u8 => btoa(String.fromCharCode(...u8))
export const rel = (yt, i, assoc) =>
  b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yt, i, assoc)))
const absIn = (yt, s) => {
  const p = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(Uint8Array.from(atob(s), c => c.charCodeAt(0))), ydoc)
  return p?.type === yt ? p.index : null
}
export function fileComments(file) {
  const yt = files.get(file)
  return !yt ? [] : [...comments].filter(([, c]) => c.file === file)
    .map(([id, c]) => ({ id, ...c, from: absIn(yt, c.anchor), to: absIn(yt, c.head) }))
    .filter(c => c.from != null && c.to != null && c.from < c.to).sort((a, b) => a.from - b.from)
}
// every comment, numbered as pinned in the preview
export function numbered() {
  let n = 0
  return [...files.keys()].sort().flatMap(f => fileComments(f).map(c => ({ ...c, n: ++n })))
}

// ---- in the editor ----
const changed = Annotation.define()
const marks = ViewPlugin.fromClass(class {
  constructor() { this.decorations = this.build() }
  update(u) {
    if (u.docChanged || u.transactions.some(t => t.annotation(changed))) this.decorations = this.build()
  }
  build() {
    const mark = Decoration.mark({ class: 'cm-comment-anchor' })
    return Decoration.set(fileComments(path).map(c => mark.range(c.from, c.to)))
  }
}, { decorations: v => v.decorations })
const hover = hoverTooltip((v, pos) => {
  const cs = fileComments(path).filter(c => c.from <= pos && pos <= c.to)
  return cs.length && { pos: cs[0].from, end: cs[0].to, above: true, create: () => ({ dom: el('div',
    { className: 'cm-comment-tip' }, ...cs.map(c => el('p', { textContent: `${c.author}: ${c.text}` }))) }) }
})
// a button on any selection: comment on it
const ask = StateField.define({
  create: () => null,
  update: (t, tr) => !tr.docChanged && !tr.selection ? t
    : t && !tr.selection && t.pos === tr.state.selection.main.to && !tr.state.selection.main.empty ? t
    : at(tr.state.selection.main),
  provide: f => showTooltip.from(f),
})
const at = r => r.empty ? null : { pos: r.to, arrow: false, create: () => {
  const b = (i, text, onclick) => el('button', { onclick, onmousedown: e => e.preventDefault() }, icon(i), text)
  const dom = el('div', { className: 'cm-ask' }, b('comment', 'Comment', () => addComment(null)),
    b('cite', 'Cite', () => citeBubble(dom)))
  return { dom }
} }
export const commentExt = [marks, hover, ask]

// ---- what is new: counted on the bar, said as it arrives ----
// comments and their replies count under Comments; other messages under Discussion
const SEEN = 'seen:' + projName, seen = JSON.parse(localStorage[SEEN] || '{}'), since = Date.now()
const others = x => x.author !== user.name
const reply = m => m.re ? 'comments' : 'chat'
export function unseen() {
  const n = { comments: 0, chat: 0 }
  for (const c of comments.values()) if (others(c) && c.ts > (seen.comments || 0)) n.comments++
  for (const m of chat.toArray()) if (others(m) && m.ts > (seen[reply(m)] || 0)) n[reply(m)]++
  return n
}
export function count() {
  const n = unseen(), all = n.comments + n.chat
  for (const b of document.querySelectorAll('.badge')) { b.hidden = !all; b.textContent = all }
  document.title = (all ? `(${all}) ` : '') + document.title.replace(/^\(\d+\) /, '')
  tabs()
}
function read(which) {
  if (!settings.sideOpen || mode !== which) return
  seen[which] = Date.now(); localStorage[SEEN] = JSON.stringify(seen); count()
}
// the pane with something new in it
export function discuss() { openSidebar(unseen().comments ? 'comments' : 'chat') }
// @ and the first name, in any script; a name without letters is never mentioned
const nick = user.name.split(/[\s@]/)[0].replace(/[^\p{L}\p{N}_]/gu, '')
const me = nick ? new RegExp(`@${nick}(?![\\p{L}\\p{N}_])`, 'iu') : /(?!)/
const say = (x, where, pane) => {
  if (!others(x) || x.ts < since || (settings.sideOpen && mode === pane)) return
  const to = me.test(x.text)
  toast(`<b>${esc(x.author)}</b> ${to ? 'mentioned you' : ''} ${where}: ${esc(x.text.slice(0, 120))}`,
    true, to ? 0 : 6000, () => openSidebar(pane))
}
comments.observe(e => {
  view?.dispatch({ annotations: changed.of(true) }); redraw('comments'); count()
  for (const [k, c] of e.changes.keys) if (c.action === 'add') say(comments.get(k), `commented on ${esc(comments.get(k).file)}`, 'comments')
})
chat.observe(e => {
  redraw('chat'); redraw('comments'); count()
  for (const m of e.changes.added) for (const x of m.content.getContent())
    say(x, x.re ? 'replied to a comment' : 'in the Discussion', reply(x))
})

export function addComment(ctx = previewContext()) {
  const sel = view?.state.selection.main
  const at = ctx ? toSource(ctx) : sel && { file: path, from: sel.from, to: sel.to }
  if (ctx && !at) return alert('Could not find that text in the source. Select it in the editor instead.')
  if (!at || at.from === at.to || !files.has(at.file))
    return alert('Select text to comment on, in the editor or the preview.')
  const text = prompt('Comment:'), yt = files.get(at.file)
  if (!text) return
  comments.set(uid(), { file: at.file, author: user.name, color: user.color, text, ts: Date.now(),
    anchor: rel(yt, at.from, 0), head: rel(yt, at.to, -1) })
  openSidebar('comments')
}

// ---- from the preview ----
// Its text is found in the source by the letters it shares with it
// (align.js); computed text (#f(R.T1), #lorem) by the code between.
// A selection inside the preview, else null
function previewContext(r = getSelection().rangeCount && getSelection().getRangeAt(0)) {
  return r && !r.collapsed && $('page').contains(r.commonAncestorContainer) ? r.cloneRange() : null
}
// A button follows a selection in the preview. Its range is taken now: a
// re-render (someone typing) would drop the selection before the click.
document.addEventListener('mouseup', () => setTimeout(() => {
  const ctx = previewContext(), b = $('pv-comment'), pv = $('pv')
  if (b.hidden = !ctx) return
  const r = ctx.getBoundingClientRect(), p = pv.getBoundingClientRect()
  b.style.left = `${r.right - p.left + pv.scrollLeft}px`
  b.style.top = `${Math.max(0, r.top - p.top + pv.scrollTop - 30)}px`
  b.onclick = () => { b.hidden = true; getSelection().removeAllRanges(); addComment(ctx) }
}))

// Double-click in the preview: to that text in the source, as Overleaf's PDF
// does. And back (Mod-Alt-J): the text at the cursor, shown in the preview.
const word = (n, i) => { // the word in a text node around i
  const r = document.createRange()
  r.setStart(n, n.data.slice(0, i).search(/[\p{L}\p{N}]*$/u)); r.setEnd(n, i + n.data.slice(i).search(/[^\p{L}\p{N}]|$/u))
  return r
}
$('page').addEventListener('dblclick', e => {
  const c = document.caretPositionFromPoint?.(e.clientX, e.clientY), r = c ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY)
  const n = c?.offsetNode ?? r?.startContainer, at = n?.nodeType === Node.TEXT_NODE && toSource(word(n, c?.offset ?? r.startOffset))
  if (!at) return
  if (phone()) { settings.m = 'edit'; applyLayout() }
  reveal(at.file, at.from, at.to)
})
export function showInPreview() {
  if (!view || !path) return
  const src = view.state.doc.toString(), at = view.state.selection.main.head
  const a = at - src.slice(0, at).match(/[\p{L}\p{N}]*$/u)[0].length, b = at + src.slice(at).search(/[^\p{L}\p{N}]|$/u)
  const [w, after, before] = toPreview(path, [[a, Math.max(b, a + 1)], [b, b + 300], [Math.max(0, a - 300), a]])
  const r = w[0] ?? after[0] ?? before.at(-1)
  if (!r) return toast('Not in the preview (is it this file\'s document, and compiled?)', false)
  if (phone()) settings.m = 'preview'
  if (settings.view === 'editor') settings.view = 'split'
  applyLayout()
  // marked a while (a highlight, not the selection, which the editor keeps)
  r.startContainer.parentElement.scrollIntoView({ block: 'center' })
  CSS.highlights?.set('pv-at', new Highlight(r)); clearTimeout(showInPreview.t)
  showInPreview.t = setTimeout(() => CSS.highlights?.delete('pv-at'), 3000)
}

// ---- the panes ----
// @names stand out: an agent member answers to its own
const mentions = text => text.split(/(@[\w-]+)/)
  .map((t, i) => i % 2 ? el('b', { className: 'at', textContent: t }) : t)
const head = (m, pre = '', post = '') => el('div', { className: 'meta' }, pre, dot(m.color || 'var(--fg-dim)'),
  el('b', { textContent: m.author }), el('time', { textContent: new Date(m.ts).toLocaleString() }), post)
const message = m => {
  const on = m.re && comments.get(m.re)
  return el('div', { className: 'msg' },
    head(m, '', on ? el('em', { textContent: `on a comment in ${on.file}` }) : ''), el('p', {}, ...mentions(m.text)))
}
// Enter sends; Shift-Enter is a new line
// what is typed outlives the pane redrawing around it (panels.js keeps focus)
const drafts = new Map()
const composer = (re, hint) => {
  const k = re ?? '', t = el('textarea', { className: 'say', rows: 1, placeholder: `${hint}; @name asks an agent`,
    value: drafts.get(k) ?? '', oninput: () => drafts.set(k, t.value) })
  t.dataset.re = k
  t.onkeydown = e => {
    const text = t.value.trim()
    if (e.key !== 'Enter' || e.shiftKey || !text) return
    e.preventDefault()
    chat.push([{ id: uid(), author: user.name, color: user.color, text, ts: Date.now(), ...re && { re } }])
    t.value = ''; drafts.delete(k)
  }
  return t
}

export function renderComments(body) {
  const cs = numbered()
  body.replaceChildren(...cs.map(c => {
    const pin = el('span', { className: 'pin-n', textContent: c.n }), meta = head(c, pin)
    if (!pinSafe(c.file, c.from))
      Object.assign(pin, { className: 'pin-n no-pin', title: 'no preview pin: anchor is inside code/raw/math' })
    meta.onclick = () => { // where it is now
      const at = fileComments(c.file).find(x => x.id === c.id)
      if (at) reveal(c.file, at.from, at.to)
    }
    const replies = chat.toArray().filter(m => m.re === c.id).map(message)
    return el('div', { className: 'comment' }, meta, el('div', { className: 'cfile', textContent: c.file }),
      el('p', {}, ...mentions(c.text)), el('div', { className: 'replies' }, ...replies, composer(c.id, 'reply')),
      el('button', { textContent: 'resolve', onclick: () => comments.delete(c.id) }))
  }))
  if (!cs.length) body.innerHTML = '<p class="empty">No comments yet. Select text in the editor or the ' +
    'preview and press <b>💬 comment</b>; it is pinned in the preview for everyone.</p>'
  read('comments')
}

export function renderChat(body) {
  const list = chat.toArray()
  body.replaceChildren(...list.length ? [] : [el('p', { className: 'empty', textContent: 'Talk with everyone ' +
    'on this project. @name tells a person, or asks an agent member to do something.' })],
  ...list.map(message), composer(null, 'Message everyone'))
  body.scrollTop = body.scrollHeight
  read('chat')
}
