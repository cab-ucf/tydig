// Shared by every module: the page, settings, the session, the hub's API.
import { link } from './link.js' // first: patches fetch and WebSocket in link mode
import { requireUser } from './auth.js'
export { link }

export const $ = id => document.getElementById(id)
export const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
export const el = (tag, props, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}
// a person's colour, as a dot (never trusted as CSS beyond a colour)
export const dot = (color, title = '') =>
  el('i', { className: 'dot', title, style: `background:${CSS.supports('color', color) ? color : 'gray'}` })
// a few line icons, 16 px, in the text's colour
const ICONS = { comment: '<path d="M2.5 3h11v7.5h-6L4.5 13v-2.5h-2z"/>',
  cite: '<path d="M7 4.5C4.8 5.3 3.5 7 3.5 9.5v2h3.5V8.5H5.3c.1-1.3.9-2.3 2.2-2.8zM13 4.5c-2.2.8-3.5 2.5-3.5 5v2H13V8.5h-1.7c.1-1.3.9-2.3 2.2-2.8z"/>',
  book: '<path d="M3 3.5a1.5 1.5 0 0 1 1.5-1.5H13v9.5H4.5A1.5 1.5 0 0 0 3 13zm0 9.5A1.5 1.5 0 0 0 4.5 14.5H13v-3"/>',
  context: '<path d="M8 13.5H3.5v-11h5l3 3v2"/><circle cx="11" cy="11" r="2.3"/><path d="m12.7 12.7 1.8 1.8"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.8 3.8"/>' }
export const icon = n => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 16 16'); s.innerHTML = ICONS[n]
  return s
}
// randomUUID exists only in secure contexts; a hub on plain-http LAN is not one
export const uid = () => crypto.getRandomValues(new Uint32Array(4)).join('-')

// the layout: which panes, and the editor's share of the two; Reset layout's
export const LAYOUT = { view: 'split', treeOpen: true, sideOpen: false, focus: false, split: 0.5, zoom: null }
export const settings = {
  vim: false, lsp: true, spell: true, theme: null, m: 'edit', ghost: null, scope: null,
  projectsOpen: true, filesOpen: true, ...LAYOUT, ...JSON.parse(localStorage.settings || '{}'),
}
// what an older tydig left, or a bad drag: never a layout without a way back
if ('max' in settings) { settings.view = settings.max || 'split'; delete settings.max }
if (!['editor', 'split', 'preview'].includes(settings.view)) settings.view = 'split'
if (settings.m === 'side' && !settings.sideOpen) settings.m = 'edit' // a phone's panel closed, then reloaded
settings.split = Math.min(0.8, Math.max(0.2, +settings.split || 0.5))
export const saveSettings = () => localStorage.settings = JSON.stringify(settings)
// dark, cyber or light; the system's until Alt-D picks one
export const system = matchMedia('(prefers-color-scheme: light)')
export const theme = () => settings.theme ?? (system.matches ? 'light' : 'dark')
document.documentElement.dataset.theme = theme()
// phones (narrow, or on their side) show one pane at a time
export const phoneQ = matchMedia('(max-width: 800px), (max-height: 500px) and (pointer: coarse)')
export const phone = () => phoneQ.matches

export const me = await requireUser()
export const api = async (p, opt) => {
  const r = await fetch('/api' + p, opt)
  if (r.status === 401) { location.reload(); return new Promise(() => {}) }
  return r.json()
}
export const post = (p, body) => api(p, { method: 'POST', ...body &&
  { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } })
export const del = p => api(p, { method: 'DELETE' })
// the models this hub serves its members, if any (TYDIG_OLLAMA, TYDIG_PERPLEXISCOPE)
export const assist = api('/assist').catch(() => ({}))

export const projName = (new URLSearchParams(location.search).get('proj') || '')
  .replace(/[^\w-]/g, '').slice(0, 64)
export const P = p => `/p/${projName}${p}`
export const rawUrl = p => `/api${P('/raw/' + p)}`

// ms 0: stays until the next toast replaces it; click: what a click on it does
export const toast = (html, ok = true, ms = ok ? 2500 : 8000, click) => {
  const t = $('toast') ?? document.body.appendChild(el('div', { id: 'toast' }))
  t.innerHTML = html; t.className = (ok ? '' : 'bad') + (click ? ' click' : ''); clearTimeout(t.timer)
  t.onclick = click && (() => { t.remove(); click() })
  if (ms) t.timer = setTimeout(() => t.remove(), ms)
}
// the key every shortcut is held with: Ctrl, or ⌘ on a Mac
export const MOD = /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl'
// pick from a list, filtered as typed: [{ label, hint, run }], or what items(typed) gives
export function choose(items, placeholder, value = '') {
  const dlg = $('qo'), input = $('qo-input'), list = $('qo-list')
  const fits = (q, s) => { let i = 0; for (const c of s.toLowerCase()) if (c === q[i]) i++; return i === q.length }
  let sel = 0, hits = []
  const render = () => {
    hits = (items.call ? items(input.value) : items.filter(x => fits(input.value.toLowerCase(), x.label))).slice(0, 50)
    sel = Math.min(sel, Math.max(0, hits.length - 1))
    list.replaceChildren(...hits.map((x, i) => el('div', { className: i === sel ? 'sel' : '',
      onclick: () => { dlg.close(); x.run() } }, x.label, x.hint ? el('kbd', { textContent: x.hint }) : '')))
    list.children[sel]?.scrollIntoView({ block: 'nearest' })
  }
  input.placeholder = placeholder; input.value = value; sel = 0; render()
  input.oninput = () => { sel = 0; render() }
  input.onkeydown = e => {
    const k = { ArrowDown: 1, ArrowUp: -1, ...e.ctrlKey && { j: 1, n: 1, k: -1, p: -1 } }[e.key]
    if (k) { sel = Math.max(0, sel + k); render() } else if (e.key === 'Enter') list.children[sel]?.click()
    else return
    e.preventDefault()
  }
  dlg.showModal(); input.focus()
}
// A link visitor's tab cannot load the hub's URLs itself: fetch, then show.
// Only a PDF is shown: from a blob: URL anything else would run in this
// page's origin, outside the sandbox the hub serves raw files under.
export const saveAs = (data, name, type, view = type === 'application/pdf') => {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })) })
  view ? a.target = '_blank' : a.download = name.split('/').pop()
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}
export const download = async (url, name) => {
  const r = await fetch(url)
  r.ok ? saveAs(await r.blob(), name, 'application/octet-stream') : alert(`download failed: ${r.status}`)
}
// Text is UTF-8 with no NUL byte, under 1 MB, whatever the file is called.
export const asText = async blob => {
  const b = blob.size < 1e6 && new Uint8Array(await blob.arrayBuffer())
  try { return b && !b.includes(0) ? new TextDecoder('utf-8', { fatal: true }).decode(b) : null }
  catch { return null }
}
