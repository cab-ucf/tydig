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
// randomUUID exists only in secure contexts; a hub on plain-http LAN is not one
export const uid = () => crypto.getRandomValues(new Uint32Array(4)).join('-')

export const settings = {
  vim: false, lsp: true, spell: true, theme: null, m: 'edit', ghost: null, scope: null, treeOpen: true,
  sideOpen: false, focus: false, projectsOpen: true, filesOpen: true,
  zoom: null, split: 0.5, max: null, ...JSON.parse(localStorage.settings || '{}'),
}
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
// pick from a list, filtered as typed: [{ label, hint, run }]
export function choose(items, placeholder) {
  const dlg = $('qo'), input = $('qo-input'), list = $('qo-list')
  const fits = (q, s) => { let i = 0; for (const c of s.toLowerCase()) if (c === q[i]) i++; return i === q.length }
  let sel = 0, hits = []
  const render = () => {
    hits = items.filter(x => fits(input.value.toLowerCase(), x.label)).slice(0, 14)
    sel = Math.min(sel, Math.max(0, hits.length - 1))
    list.replaceChildren(...hits.map((x, i) => el('div', { className: i === sel ? 'sel' : '',
      onclick: () => { dlg.close(); x.run() } }, x.label, x.hint ? el('kbd', { textContent: x.hint }) : '')))
  }
  input.placeholder = placeholder; input.value = ''; sel = 0; render()
  input.oninput = () => { sel = 0; render() }
  input.onkeydown = e => {
    const k = { ArrowDown: 1, ArrowUp: -1 }[e.key]
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
