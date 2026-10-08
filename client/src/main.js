import { link } from './link.js' // first: patches fetch and WebSocket in link mode
import { basicSetup } from 'codemirror'
import { EditorView, keymap, Decoration, ViewPlugin } from '@codemirror/view'
import { EditorState, Annotation, Compartment, Prec } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting, LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { indentWithTab } from '@codemirror/commands'
import { tags as t } from '@lezer/highlight'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { vim } from '@replit/codemirror-vim'
import { typst } from 'codemirror-lang-typst'
import { LanguageServerClient, WebSocketTransport, languageServerWithTransport } from 'codemirror-languageserver'
import { $typst } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'
import { preloadRemoteFonts } from '@myriaddreamin/typst.ts/dist/esm/options.init.mjs'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

import { IndexeddbPersistence } from 'y-indexeddb'
import { authClient, requireUser } from './auth.js'
import { registerDeviceKey, signCheckpoint } from './prov.js'

const $ = id => document.getElementById(id)

// ---------- settings (persisted) ----------
const settings = Object.assign(
  { vim: false, lsp: true, darkPreview: true, treeOpen: true, sideOpen: false, focus: false, projectsOpen: true, filesOpen: true, zoom: 1 },
  JSON.parse(localStorage.settings || '{}'))
const saveSettings = () => localStorage.settings = JSON.stringify(settings)

// ---------- auth: session cookie carried automatically by fetch + ws ----------
const me = await requireUser()
const api = async (p, opt = {}) => {
  const r = await fetch('/api' + p, { credentials: 'same-origin', ...opt })
  if (r.status === 401) { location.reload(); return new Promise(() => {}) }
  return r.json()
}

// ---------- project selection ----------
const params = new URLSearchParams(location.search)
const projName = (params.get('proj') || '').replace(/[^\w-]/g, '').slice(0, 64)
async function openPicker() {
  const list = await api('/projects')
  $('proj-list').replaceChildren(...list.map(({ name: n, role }) => {
    const a = document.createElement('a')
    a.href = `?proj=${n}${location.hash}`; a.textContent = role === 'owner' ? `${n} (owner)` : n
    if (n === projName) a.className = 'current'
    return a
  }))
  $('proj-new').onsubmit = async () => {
    const n = $('proj-name').value
    const r = await api(`/projects/${n}`, { method: 'POST' })
    if (r.error) return alert(r.error)
    location.search = `?proj=${n}`
  }
  $('proj-join').onsubmit = async () => {
    const invite = $('proj-invite').value.trim()
    const m = /^tydig-fed:([\w-]+):/.exec(invite)
    if (!m) return alert('That is not a federation invite (expected tydig-fed:project:token:ticket).')
    const r = await api(`/projects/${m[1]}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite }) })
    if (r.error) return alert(r.error)
    location.search = `?proj=${m[1]}`
  }
  $('proj-git').onsubmit = async () => {
    const url = $('proj-git-url').value.trim()
    if (!url) return
    const guess = (url.replace(/\.git$/, '').split('/').pop() || '').replace(/[^\w-]/g, '').slice(0, 64)
    const name = prompt('Open as project name:', guess)
    if (!name) return
    const r = await api(`/projects/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gitUrl: url }) })
    if (r.error) return alert(r.error)
    location.search = `?proj=${name}`
  }
  $('picker').showModal()
}
if (!projName) { openPicker(); throw new Error('awaiting project choice') }
$('projname').textContent = projName
const P = p => `/p/${projName}${p}`
const rawUrl = rel => `/api${P('/raw/' + rel)}`
// A link visitor's tab cannot load the hub's URLs itself: fetch, then show.
// Anything but a PDF is downloaded: opened from a blob: URL it would run in
// this page's origin, outside the sandbox the hub serves raw files under.
const saveAs = (blob, p, type) => {
  const a = document.createElement('a'), pdf = type === 'application/pdf'
  a.href = URL.createObjectURL(new Blob([blob], { type }))
  pdf ? a.target = '_blank' : a.download = p.split('/').pop()
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}
// Text is UTF-8 with no NUL byte, under 1 MB, whatever the file is called.
const asText = async blob => {
  const b = blob.size < 1e6 && new Uint8Array(await blob.arrayBuffer())
  try { return b && !b.includes(0) ? new TextDecoder('utf-8', { fatal: true }).decode(b) : null } catch { return null }
}
// Syntax for any file the editor shows, by name (loaded on demand).
const langFor = async p => p.endsWith('.typ') ? typst()
  : await LanguageDescription.matchFilename(languages, p.replace(/Containerfile$/, 'Dockerfile'))?.load() ?? []

// ---------- identity (from account; color stays a local preference) ----------
const userName = me.name || me.email
const userColor = localStorage.userColor ||
  (localStorage.userColor = `hsl(${Math.floor(Math.random() * 360)} 70% 45%)`)

// ---------- CRDT + offline persistence ----------
const ydoc = new Y.Doc()
const filesMap = ydoc.getMap('files')
const ycomments = ydoc.getMap('comments')
const ymeta = ydoc.getMap('meta')

// IndexedDB keeps the whole doc locally: edits made offline survive reloads
// and replay (conflict-free, it is a CRDT) when the socket reconnects.
const persistence = new IndexeddbPersistence(`tydig:${link ? link.id + ':' : ''}${projName}`, ydoc)
let offlineReady = false
persistence.whenSynced.then(() => { offlineReady = true })

const sessionToken = () => /better-auth\.session_token=([^;]+)/.exec(document.cookie)?.[1] || ''
// Change-review: when we drop offline, remember each file's text. On
// reconnect, if any file changed remotely while we were away, surface a
// "while you were away" review so a non-technical user can keep or revert
// each change. (The CRDT already merged everything; this is about awareness
// and one-click undo, not conflict resolution.)
let away = false
const snapshotFiles = () => {
  const m = {}
  for (const [p, t] of filesMap) m[p] = t.toString()
  return m
}
const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
const provider = new HocuspocusProvider({
  url: `${wsProto}://${location.host}/sync`, name: projName, document: ydoc,
  token: sessionToken,
  onStatus: ({ status }) => {
    const el = $('status')
    el.dataset.state = status
    el.textContent = status === 'connected' ? 'online'
      : status === 'connecting' ? 'connecting' : 'offline (saving locally)'
    if (status === 'disconnected' && offlineReady) away = true
    // 'connected' fires before the sync applies: this snapshot is my offline
    // version, own offline edits included, so "revert to mine" keeps them.
    if (status === 'connected' && away) {
      const before = snapshotFiles(); away = false
      setTimeout(() => maybeReview(before), 1200) // let remote updates settle
    }
  },
  onAuthenticationFailed: () => { alert('Lost access to this project.'); location.search = '' },
})
provider.setAwarenessField('user', { name: userName, color: userColor, colorLight: userColor })
// redraw the tree only when someone opens another file, not on every cursor move
let whereabouts = ''
provider.awareness.on('change', () => {
  const states = provider.awareness.getStates(), w = [...states].map(([id, s]) => `${id}:${s.file}`).join()
  $('peers').textContent = `${states.size} online`
  if (w !== whereabouts) { whereabouts = w; renderTree() }
})

// ---------- comment anchors (assoc 0 start, -1 end: no range creep) ----------
const b64 = u8 => btoa(String.fromCharCode(...u8))
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const rel = (yt, idx, assoc) => b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yt, idx, assoc)))
const absIn = (yt, s) => {
  const pos = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(unb64(s)), ydoc)
  return pos && pos.type === yt ? pos.index : null
}
function fileComments(file) {
  const yt = filesMap.get(file)
  if (!yt) return []
  return [...ycomments.entries()]
    .filter(([, c]) => c.file === file)
    .map(([id, c]) => ({ id, ...c, from: absIn(yt, c.anchor), to: absIn(yt, c.head) }))
    .filter(c => c.from != null && c.to != null && c.from < c.to)
    .sort((a, b) => a.from - b.from)
}
function numberedComments() {
  let n = 0
  return [...filesMap.keys()].sort().flatMap(f => fileComments(f).map(c => ({ ...c, n: ++n })))
}

// ---------- LSP (tinymist via server ws bridge; silently off if unavailable) ----------
let lspClient = null, lspRoot = null, lspDead = false
async function lspExts(filePath) {
  if (!settings.lsp || lspDead || !filePath.endsWith('.typ')) return []
  try {
    // a promise, so files opened together share one server; a closed one is
    // dropped, and the next file opened (or the LSP toggle) starts afresh
    const gone = () => { lspDead = true; lspClient = null }
    lspClient ??= api(P('/info')).then(({ root }) => {
      lspRoot = root
      const transport = new WebSocketTransport(
        `${wsProto}://${location.host}/lsp?proj=${projName}&t=${encodeURIComponent(sessionToken())}`)
      return new LanguageServerClient({
        transport, autoClose: false,
        rootUri: `file://${lspRoot}`,
        workspaceFolders: [{ name: projName, uri: `file://${lspRoot}` }],
        documentUri: `file://${lspRoot}/${filePath}`, languageId: 'typst',
        onError: gone, onClose: gone,
      })
    })
    return languageServerWithTransport({
      client: await lspClient, rootUri: `file://${lspRoot}`,
      workspaceFolders: [{ name: projName, uri: `file://${lspRoot}` }],
      documentUri: `file://${lspRoot}/${filePath}`, languageId: 'typst',
    })
  } catch { lspDead = true; return [] }
}

// ---------- dark editor theme ----------
const darkHighlight = Prec.high(syntaxHighlighting(HighlightStyle.define([
  { tag: t.heading, color: '#5ec5d4', fontWeight: 'bold' },
  { tag: t.strong, color: '#eef2f6', fontWeight: 'bold' },
  { tag: t.emphasis, color: '#eef2f6', fontStyle: 'italic' },
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.string, color: '#a5d6a7' },
  { tag: t.number, color: '#f3a96a' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#69727e', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: t.variableName, color: '#d7dce2' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#7fd1de' },
  { tag: [t.labelName, t.tagName], color: '#f3a96a' },
  { tag: [t.link, t.url], color: '#5ec5d4', textDecoration: 'underline' },
  { tag: t.monospace, color: '#cba6f7' },
  { tag: [t.processingInstruction, t.macroName], color: '#7fd1de' },
])))
const darkChrome = EditorView.theme({}, { dark: true })

// ---------- editor ----------
const commentsChanged = Annotation.define()
let view = null, currentPath = null
const undoManagers = new Map()
const vimComp = new Compartment(), langComp = new Compartment(), lspComp = new Compartment()

const commentHighlights = ViewPlugin.fromClass(class {
  constructor() { this.decorations = this.build() }
  update(u) {
    if (u.docChanged || u.transactions.some(t => t.annotation(commentsChanged))) this.decorations = this.build()
  }
  build() {
    return Decoration.set(fileComments(currentPath).map(c =>
      Decoration.mark({ class: 'cm-comment-anchor' }).range(c.from, c.to)))
  }
}, { decorations: v => v.decorations })

let opening = 0
async function openFile(p) {
  const yt = filesMap.get(p)
  if (!yt) return
  const my = ++opening, lsp = await lspExts(p)
  if (my !== opening) return // another file was opened meanwhile
  currentPath = p
  if (!undoManagers.has(p)) undoManagers.set(p, new Y.UndoManager(yt))
  const lang = await langFor(p)
  if (my !== opening) return
  view?.destroy(); $('editor').replaceChildren()
  view = new EditorView({
    state: EditorState.create({
      doc: yt.toString(),
      extensions: [
        vimComp.of(settings.vim ? vim() : []),
        basicSetup,
        darkHighlight, darkChrome,
        keymap.of([indentWithTab]),
        langComp.of(lang),
        lspComp.of(lsp),
        keymap.of([...yUndoManagerKeymap, { key: 'Ctrl-Alt-m', run: () => (addComment(), true) }]),
        yCollab(yt, provider.awareness, { undoManager: undoManagers.get(p) }),
        commentHighlights,
        EditorView.lineWrapping,
        EditorView.updateListener.of(u => { if (u.docChanged) { scheduleCompile(); updateWordCount() } }),
      ],
    }),
    parent: $('editor'),
  })
  provider.setAwarenessField('file', p)
  localStorage['last:' + projName] = p
  updateWordCount()
  renderTree(); renderMainSel()
}

function updateWordCount() {
  const src = currentPath?.endsWith('.typ') ? view?.state.doc.toString() : null
  $('wordcount').textContent = src ? `${(src.match(/[\p{L}\p{N}']+/gu) || []).length} words` : ''
}

// Files outside the CRDT open here too: build output as read-only text, an
// image as itself, a PDF beside; only what has no view is downloaded.
// (Never a blob: page: an uploaded .svg or .html would run in this origin.)
async function openDisk(p) {
  const my = ++opening, r = await fetch(rawUrl(p))
  if (!r.ok) return alert(`${p}: ${r.status}`)
  const blob = await r.blob(), text = isImg(p) ? null : await asText(blob)
  if (my !== opening) return
  if (/\.pdf$/i.test(p) || (!isImg(p) && text == null)) return saveAs(blob, p, /\.pdf$/i.test(p) ? 'application/pdf' : 'application/octet-stream')
  const lang = text != null && await langFor(p)
  if (my !== opening) return
  view?.destroy(); view = null; currentPath = p
  if (text == null) {
    const img = Object.assign(new Image(), { className: 'disk-img', alt: p,
      src: URL.createObjectURL(new Blob([blob], { type: /\.svg$/i.test(p) ? 'image/svg+xml' : blob.type })) })
    img.onload = () => URL.revokeObjectURL(img.src)
    $('editor').replaceChildren(img)
  } else {
    $('editor').replaceChildren()
    view = new EditorView({ parent: $('editor'), state: EditorState.create({ doc: text, extensions: [
      basicSetup, darkHighlight, darkChrome, lang, EditorView.lineWrapping, EditorState.readOnly.of(true)] }) })
  }
  updateWordCount(); renderTree()
}

function addComment(ctx = previewContext()) {
  const sel = view?.state.selection.main, at = ctx ? locate(...ctx) : sel && { file: currentPath, from: sel.from, to: sel.to }
  if (ctx && !at) return alert('Could not find that text in the source. Select it in the editor instead.')
  if (!at || at.from === at.to || !filesMap.has(at.file)) return alert('Select text to comment on, in the editor or the preview.')
  const text = prompt('Comment:')
  if (!text) return
  const yt = filesMap.get(at.file)
  // randomUUID exists only in secure contexts; a hub on plain-http LAN is not one
  ycomments.set(crypto.getRandomValues(new Uint32Array(4)).join('-'), {
    file: at.file, author: userName, color: userColor, text, ts: Date.now(),
    anchor: rel(yt, at.from, 0), head: rel(yt, at.to, -1),
  })
  openSidebar('comments')
}

// ---------- comments from the preview ----------
// The preview's text layer is the source minus markup, so a selection there
// is found in the source by letters and digits alone (math italics folded). The text around it
// picks among repeats, and computed text (#f(R.T1)) anchors to the code
// between the literal text on either side.
const LN = /[\p{L}\p{N}]/u
const norm = s => { let k = ''; const at = []; for (let i = 0; i < s.length; i++) if (LN.test(s[i])) { k += s[i]; at.push(i) } return { k, at } }
const back = (a, i, b) => { let n = 0; while (n < i && n < b.length && a[i - 1 - n] === b[b.length - 1 - n]) n++; return n }
const fwd = (a, i, b) => { let n = 0; while (i + n < a.length && n < b.length && a[i + n] === b[n]) n++; return n }
function locate(before, sel, after) {
  const [L, Q, R] = [before, sel, after].map(s => norm(s.normalize('NFKC')).k) // 𝑇 -> T, ﬁ -> fi
  let best = { score: 2 }
  for (const [file, yt] of filesMap) {
    if (!file.endsWith('.typ')) continue
    const src = yt.toString(), { k, at } = norm(src)
    const hit = (from, to, score) => score > best.score && (best = { score, file, from, to })
    for (let i = Q ? k.indexOf(Q) : -1; i >= 0; i = k.indexOf(Q, i + 1)) hit(at[i], at[i + Q.length - 1] + 1, Q.length + back(k, i, L) + fwd(k, i + Q.length, R))
    let i = 0, b = 0
    for (let x = 1; x <= k.length; x++) { const n = back(k, x, L); if (n > b) [i, b] = [x, n] }
    let j = i, f = 0
    for (let y = i; y <= Math.min(k.length, i + 400); y++) { const n = fwd(k, y, R); if (n > f) [j, f] = [y, n] }
    // everything between the two matches, trimmed of surrounding whitespace
    let from = i ? at[i - 1] + 1 : 0, to = j < k.length ? at[j] : src.length
    while (from < to && /\s/.test(src[from])) from++
    while (to > from && /\s/.test(src[to - 1])) to--
    hit(from, to, b + f)
  }
  return best.file && { ...best, to: Math.max(best.to, best.from + 1) }
}
// [before, selected, after] for a selection inside the preview, else null
function previewContext() {
  const s = getSelection(), r = s.rangeCount && s.getRangeAt(0)
  if (!r || r.collapsed || !$('page').contains(r.commonAncestorContainer)) return null
  const side = start => { const x = document.createRange(); x.selectNodeContents($('page')); start ? x.setEnd(r.startContainer, r.startOffset) : x.setStart(r.endContainer, r.endOffset); return x.toString() }
  return [side(true).slice(-300), r.toString(), side(false).slice(0, 300)]
}
// A comment button follows a selection in the preview. The context is taken
// now: a re-render (someone typing) would drop the selection before the click.
document.addEventListener('mouseup', () => setTimeout(() => {
  const ctx = previewContext(), b = $('pv-comment')
  b.hidden = !ctx
  if (!ctx) return
  const r = getSelection().getRangeAt(0).getBoundingClientRect(), p = $('preview').getBoundingClientRect()
  b.style.left = `${r.right - p.left + $('preview').scrollLeft}px`
  b.style.top = `${Math.max(0, r.top - p.top + $('preview').scrollTop - 30)}px`
  b.onclick = () => { b.hidden = true; getSelection().removeAllRanges(); addComment(ctx) }
}))
$('pv-comment').onmousedown = $('bar-comment').onmousedown = e => e.preventDefault() // keep the selection
ycomments.observe(() => {
  view?.dispatch({ annotations: commentsChanged.of(true) })
  if (sidebarMode === 'comments') renderComments()
  scheduleCompile()
})

// ---------- file tree ----------
let diskFiles = []
const isImg = p => /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(p)
const GEN = /^(out|build|figures)\//
const okPath = p => /^[\w./@ -]+$/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
// Text outside generated dirs lives in the CRDT; anything else is a disk file.
const badNew = p => !okPath(p) ? 'Bad path.' : GEN.test(p) ? `${p.split('/')[0]}/ is build output: text there is never saved.` : filesMap.has(p) ? 'Target exists.' : null
async function refreshDisk() { diskFiles = await api(P('/files')); renderTree(); scheduleCompile() }
// server bumps meta.diskRev whenever anything changes on disk (builds, shell
// edits, other collaborators' builds) -> live preview without clicking build
let metaT
ymeta.observe(() => { clearTimeout(metaT); metaT = setTimeout(refreshDisk, 200) })

const openDirs = new Set(JSON.parse(localStorage['dirs:' + projName] || '[]'))
const saveDirs = () => localStorage['dirs:' + projName] = JSON.stringify([...openDirs])

function renderTree() {
  const yPaths = new Set(filesMap.keys())
  const all = [...new Set([...yPaths, ...diskFiles.map(f => f.path)])]
  const peersByFile = {}
  for (const [, st] of provider.awareness.getStates())
    if (st.file && st.user) (peersByFile[st.file] ??= []).push(st.user)

  const root = { dirs: new Map(), files: [] }
  for (const p of all) {
    let n = root
    for (const d of p.split('/').slice(0, -1)) {
      if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [] })
      n = n.dirs.get(d)
    }
    n.files.push(p)
  }

  const rows = []
  const fileRow = (p, depth) => {
    const el = document.createElement('div')
    el.className = 'tnode' + (p === currentPath ? ' active' : '') + (yPaths.has(p) ? ' text' : ' bin')
    el.style.paddingLeft = `${0.5 + depth * 0.85}rem`
    el.innerHTML = `<span class="fname"></span><span class="dots"></span><span class="ops"><button class="rn" title="rename">~</button><button class="del" title="delete">x</button></span>`
    el.querySelector('.fname').textContent = p.split('/').pop()
    el.title = p
    el.querySelector('.dots').replaceChildren(...(peersByFile[p] ?? []).map(u => {
      const d = document.createElement('i'); d.className = 'dot'; d.style.background = u.color; d.title = u.name; return d
    }))
    el.querySelector('.fname').onclick = () =>
      yPaths.has(p) ? openFile(p) : openDisk(p)
    el.querySelector('.rn').onclick = () => renameFile(p)
    el.querySelector('.del').onclick = async () => {
      if (!confirm(`Delete ${p}?`)) return
      if (yPaths.has(p)) filesMap.delete(p)
      else { await api(P('/raw/' + p), { method: 'DELETE' }); refreshDisk() }
    }
    return el
  }
  const dirRow = (name, full, depth) => {
    const open = openDirs.has(full)
    const el = document.createElement('div')
    el.className = 'tnode dir'
    el.style.paddingLeft = `${0.5 + depth * 0.85}rem`
    el.innerHTML = `<span class="tw">${open ? '&#9662;' : '&#9656;'}</span><span class="fname"></span><span class="ops"><button class="addf" title="new file here">+</button><button class="upd" title="upload here">up</button></span>`
    el.querySelector('.fname').textContent = name
    el.title = full
    const toggle = () => { open ? openDirs.delete(full) : openDirs.add(full); saveDirs(); renderTree() }
    el.querySelector('.tw').onclick = toggle
    el.querySelector('.fname').onclick = toggle
    el.querySelector('.addf').onclick = e => { e.stopPropagation(); newFile(full + '/') }
    el.querySelector('.upd').onclick = e => { e.stopPropagation(); uploadTo(full) }
    el.ondragover = e => { e.preventDefault(); el.classList.add('dropping') }
    el.ondragleave = () => el.classList.remove('dropping')
    el.ondrop = e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('dropping'); dropUpload(e.dataTransfer.files, full) }
    return el
  }
  const emit = (node, prefix, depth) => {
    for (const [d, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const full = prefix + d
      rows.push(dirRow(d, full, depth))
      if (openDirs.has(full)) emit(child, full + '/', depth + 1)
    }
    for (const p of node.files.sort()) rows.push(fileRow(p, depth))
  }
  emit(root, '', 0)
  $('tree').replaceChildren(...rows)
}
$('tree').ondragover = e => e.preventDefault()
$('tree').ondrop = e => { e.preventDefault(); dropUpload(e.dataTransfer.files, '') }

// Text outside build dirs goes into the CRDT (editable, synced); anything
// else -- images, PDFs, big data -- is a disk file.
async function dropUpload(files, dir) {
  const failed = []
  for (const f of files) {
    const p = (dir ? dir + '/' : '') + f.name.replace(/[^\w.@ -]/g, '_'), t = filesMap.get(p)
    const s = okPath(p) && !GEN.test(p) ? await asText(f) : null
    if (s != null) {
      t ? ydoc.transact(() => { t.delete(0, t.length); t.insert(0, s) }) : filesMap.set(p, new Y.Text(s))
    } else {
      const r = await fetch(rawUrl(p), { method: 'PUT', body: f })
      if (!r.ok) failed.push(`${p}: ${r.status === 413 ? 'larger than 50 MB' : (await r.json().catch(() => ({}))).error || r.statusText}`)
    }
  }
  dir.split('/').forEach((_, i, a) => a[0] && openDirs.add(a.slice(0, i + 1).join('/'))) // show where it went
  saveDirs(); refreshDisk()
  if (failed.length) alert(`Not uploaded:\n${failed.join('\n')}`)
}
function uploadTo(dir = '') {
  $('upload-input').dataset.dir = dir
  $('upload-input').click()
}
function renameFile(p) {
  const yt = filesMap.get(p)
  if (!yt) return alert('Disk-only files: move via shell or a recipe.')
  const np = prompt('New path:', p)?.replace(/^\/+/, '')
  if (!np || np === p) return
  const bad = badNew(np); if (bad) return alert(bad)
  const saved = [...ycomments.entries()].filter(([, c]) => c.file === p)
    .map(([id, c]) => ({ id, c, from: absIn(yt, c.anchor), to: absIn(yt, c.head) }))
  const content = yt.toString()
  ydoc.transact(() => {
    const nyt = new Y.Text(content)
    filesMap.set(np, nyt)
    filesMap.delete(p)
    for (const sv of saved)
      if (sv.from != null && sv.to != null)
        ycomments.set(sv.id, { ...sv.c, file: np, anchor: rel(nyt, sv.from, 0), head: rel(nyt, sv.to, -1) })
  })
  if (currentPath === p) openFile(np)
}

filesMap.observeDeep(evs => {
  if (evs.some(e => e.target === filesMap)) { renderTree(); renderMainSel() } // files added or removed
  scheduleCompile()
  if (evs.some(e => (e.target === filesMap ? [...e.keysChanged] : e.path.slice(0, 1)).some(p => /^(data|scripts)\//.test(p)))) maybeWatchBuild()
})

function newFile(prefix = '') {
  const p = prompt('Path (dirs auto-created), e.g. chapters/01-intro.typ:', prefix)
  if (!p) return
  const clean = p.replace(/^\/+/, '')
  const bad = !filesMap.has(clean) && badNew(clean); if (bad) return alert(bad)
  if (!filesMap.has(clean)) filesMap.set(clean, new Y.Text(''))
  openFile(clean)
}
$('new-file').onclick = newFile
$('upload').onclick = () => uploadTo()
$('upload-input').onchange = async e => {
  // copy, then clear: the same file can be picked again, and no folder lingers
  const files = [...e.target.files], dir = e.target.dataset.dir || prompt('Upload into directory (empty for root):', 'figures')
  e.target.value = ''; e.target.dataset.dir = ''
  if (dir != null) await dropUpload(files, dir.replace(/^\/+|\/+$/g, ''))
}

// ---------- typst preview (live 'typst watch' in-browser) ----------
// Typst's own fonts (what the CLI embeds), bundled: the preview needs no
// network and sets type exactly like the built PDF.
const fonts = Object.values(import.meta.glob('./fonts/*.{otf,ttf}', { query: '?url', import: 'default', eager: true }))
$typst.setCompilerInitOptions({ getModule: () => compilerWasm, beforeBuild: [preloadRemoteFonts(fonts, { assets: false })] })
$typst.setRendererInitOptions({ getModule: () => rendererWasm })

function renderMainSel() {
  const typs = [...filesMap.keys()].filter(p => p.endsWith('.typ')).sort()
  const sel = $('main-sel'), prev = sel.value
  sel.replaceChildren(...typs.map(p => new Option(p, p)))
  sel.value = typs.includes(prev) ? prev : (typs.includes('main.typ') ? 'main.typ' : typs[0] ?? '')
}
$('main-sel').onchange = scheduleCompile

const pin = n => `#box(width: 0pt, height: 0pt, place(dx: 1pt, dy: -10pt, circle(radius: 4pt, fill: rgb("#239dad"), stroke: none, inset: 0pt)[#align(center + horizon, text(white, 5.5pt)[${n}])]))`

// A pin is only injected where the tree-sitter grammar says the offset is in
// markup context. Inside raw spans it would render as literal text; inside
// code/math/strings/comments it would break the compile. Those comments keep
// their sidebar entry and editor highlight, just no preview pin.
const typstParser = typst().language.parser
const parseMemo = new Map()
function parsed(file, src) {
  const m = parseMemo.get(file)
  if (m?.src === src) return m.tree
  const tree = typstParser.parse(src)
  parseMemo.set(file, { src, tree })
  return tree
}
const UNSAFE_NODE = /^(Raw|Code|CodeBlock|Math|Equation|LineComment|BlockComment|Str|String|Label|Ref|Ident)$/
function pinSafe(file, from) {
  const src = filesMap.get(file)?.toString()
  if (src == null) return false
  const tree = parsed(file, src)
  for (let n = tree.resolveInner(from, from === 0 ? 1 : -1); n; n = n.parent) {
    if (n.name === 'Markup') return true
    if (UNSAFE_NODE.test(n.name)) return false
  }
  return false
}
function pinnedSource(file, src) {
  const cs = numberedComments()
    .filter(c => c.file === file && pinSafe(file, c.from))
    .sort((a, b) => b.from - a.from)
  for (const c of cs) src = src.slice(0, c.from) + pin(c.n) + src.slice(c.from)
  return src
}

const binCache = new Map()
async function fetchBin(f) { // one entry per path: a rebuilt figure replaces the old one
  const k = `${f.size}:${f.mtime}`, c = binCache.get(f.path)
  if (c?.k === k) return c.bytes
  const r = await fetch(rawUrl(f.path))
  if (!r.ok) throw new Error(`${f.path}: ${r.status}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  binCache.set(f.path, { k, bytes })
  return bytes
}

async function loadVfs(withPins) {
  await $typst.resetShadow()
  for (const [p, t] of filesMap) {
    const src = t.toString()
    await $typst.addSource('/' + p, withPins && p.endsWith('.typ') ? pinnedSource(p, src) : src)
  }
  for (const f of diskFiles)
    if (!filesMap.has(f.path) && !f.path.startsWith('out/') && f.size < 8_000_000)
      await $typst.mapShadow('/' + f.path, await fetchBin(f))
}

// The WASM compiler reports any file absent from its virtual filesystem as
// "access denied ... outside of project root", which sends people hunting for
// a --root flag that does not exist here. Work out which referenced files are
// actually missing and say so.
function missingReferences() {
  const present = new Set([...filesMap.keys(), ...diskFiles.map(f => f.path)])
  const missing = new Set()
  for (const [p, t] of filesMap) {
    if (!p.endsWith('.typ')) continue
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''
    for (const m of t.toString().matchAll(/\b(?:image|json|csv|yaml|toml|xml|read|include|import)\(\s*"([^"]+)"/g)) {
      const ref = m[1]
      if (ref.startsWith('@')) continue // package
      const abs = ref.startsWith('/') ? ref.slice(1) : dir + ref
      if (!present.has(abs)) missing.add(abs)
    }
  }
  return [...missing]
}
function explainCompileError(e) {
  const raw = String(e?.message || e)
  if (!/access denied|outside of project root/.test(raw)) return raw
  const missing = missingReferences()
  const gen = missing.filter(p => /^(build|figures|out)\//.test(p))
  let msg = missing.length
    ? `The document reads ${missing.length === 1 ? 'a file that does not exist yet' : 'files that do not exist yet'}: ${missing.join(', ')}.`
    : 'The document reads a file that does not exist in the project.'
  if (gen.length) msg += ` ${gen.length === 1 ? 'It is' : 'They are'} produced by the build: open the build panel and run "all".`
  msg += '\n\n(The compiler phrases this as "access denied / outside of project root"; there is no --root to set in the preview, the file is simply absent.)'
  return msg
}

let timer, compiling = false, dirty = false, seq = 0
// one virtual filesystem: a compile and a PDF export must not refill it at once
let vfsQ = Promise.resolve()
const serial = f => (vfsQ = vfsQ.then(f, f))
function scheduleCompile() { clearTimeout(timer); timer = setTimeout(compile, 300) }
async function compile() {
  const main = $('main-sel').value
  if (!main) return
  if (compiling) { dirty = true; return }
  compiling = true
  const my = ++seq
  try {
    const svg = await serial(async () => {
      try { await loadVfs(true); return await $typst.svg({ mainFilePath: '/' + main }) }
      catch { await loadVfs(false); return await $typst.svg({ mainFilePath: '/' + main }) }
    })
    if (my === seq) {
      $('page').innerHTML = svg
      $('page').querySelectorAll('a[href^="javascript:" i], a[href^="data:" i]').forEach(a => a.removeAttribute('href'))
      $('diag').hidden = true
    }
  } catch (e) {
    if (my === seq) { $('diag').textContent = explainCompileError(e); $('diag').hidden = false }
  }
  compiling = false
  if (dirty) { dirty = false; scheduleCompile() }
}

async function exportPdf() {
  const main = $('main-sel').value
  if (!main) return
  const bytes = await serial(async () => { await loadVfs(false); return $typst.pdf({ mainFilePath: '/' + main }) }) // never export pins
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  a.download = main.replace(/\.typ$/, '.pdf')
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

// ---------- watch builds: rerun a recipe when data/ or scripts/ change ----------
let watchRecipe = null, watchT, watchRunning = false
function maybeWatchBuild() {
  if (!watchRecipe) return
  clearTimeout(watchT)
  watchT = setTimeout(async () => {
    if (watchRunning) return
    watchRunning = true
    await api(P('/build/' + watchRecipe), { method: 'POST' })
    watchRunning = false
    refreshDisk()
  }, 800)
}

// ---------- sidebar ----------
const sideBody = $('side-body')
let sidebarMode = null
function openSidebar(mode) {
  sidebarMode = mode
  settings.sideOpen = true; applyLayout()
  $('side-title').textContent = mode
  ;({ comments: renderComments, history: renderHistory, build: renderBuild, review: renderReview })[mode]()
}
$('side-close').onclick = () => { settings.sideOpen = false; sidebarMode = null; applyLayout() }

function renderComments() {
  const items = numberedComments()
  sideBody.replaceChildren(...items.map(c => {
    const el = document.createElement('div')
    el.className = 'comment'
    el.innerHTML = `<div class="meta"><span class="pin-n"></span><span class="dot"></span><b></b><time>${new Date(c.ts).toLocaleString()}</time></div><div class="cfile"></div><p></p><button>resolve</button>`
    el.querySelector('.pin-n').textContent = c.n
    el.querySelector('.dot').style.background = c.color
    if (!pinSafe(c.file, c.from)) {
      el.querySelector('.pin-n').classList.add('no-pin')
      el.querySelector('.pin-n').title = 'no preview pin: anchor is inside code/raw/math'
    }
    el.querySelector('b').textContent = c.author
    el.querySelector('.cfile').textContent = c.file
    el.querySelector('p').textContent = c.text
    el.querySelector('button').onclick = () => ycomments.delete(c.id)
    el.querySelector('.meta').onclick = async () => {
      if (currentPath !== c.file) await openFile(c.file)
      const cc = fileComments(c.file).find(x => x.id === c.id)
      if (cc) view.dispatch({ selection: { anchor: cc.from, head: cc.to }, scrollIntoView: true })
      view.focus()
    }
    return el
  }))
  if (!items.length) sideBody.innerHTML = '<p class="empty">No comments. Select text, then Edit > Comment. Pins appear in the preview.</p>'
}

async function renderHistory() {
  const log = await api(P('/history'))
  if (sidebarMode !== 'history') return // another panel was opened meanwhile
  sideBody.replaceChildren(...log.map(({ hash, date, message, provenance }) => {
    const el = document.createElement('div')
    el.className = 'commit' + (message.startsWith('checkpoint') ? ' checkpoint' : '')
    const badge = provenance
      ? (provenance.verified
          ? `<span class="prov ok" title="ML-DSA-65 signature by a key registered to this account; file hashes match (key ${provenance.keyId})">signed &#10003;</span>`
          : `<span class="prov warn" title="signature present but not verifiable">unverified</span>`)
      : ''
    el.innerHTML = `<code>${hash}</code><span></span>${badge}<time>${new Date(date).toLocaleString()}</time><button>restore</button>`
    el.querySelector('span').textContent = message
    el.querySelector('button').onclick = async () => {
      if (!confirm(`Restore ${hash}? Applies live for everyone; restore a later commit to go back.`)) return
      await api(P('/restore/' + hash), { method: 'POST' })
    }
    return el
  }))
  if (!log.length) sideBody.innerHTML = '<p class="empty">No commits yet. Edits autosave every few seconds.</p>'
}

async function renderBuild() {
  const recipes = await api(P('/recipes'))
  if (sidebarMode !== 'build') return
  sideBody.innerHTML = ''
  if (recipes.error) {
    sideBody.innerHTML = `<p class="empty">${esc(recipes.error)}</p><p class="empty">The live preview does not need builds; recipes are for figures, scripts, and final PDFs.</p>`
    return
  }
  // The server tells us whether this project is make- or just-driven so the
  // labels say what will actually run.
  const tool = (await api(P('/info')).catch(() => ({}))).tool || 'make'
  const log = document.createElement('pre'); log.className = 'buildlog'
  const watchRow = document.createElement('div'); watchRow.className = 'recipe'
  watchRow.innerHTML = `<label title="rerun when data/ or scripts/ change"><input type="checkbox" id="watch-ck"/> watch</label>
    <select id="watch-sel">${recipes.map(r => `<option${r === (recipes.includes('analysis') ? 'analysis' : 'figures') ? ' selected' : ''}>${r}</option>`).join('')}</select>`
  watchRow.querySelector('#watch-ck').checked = !!watchRecipe
  const syncWatch = () => {
    watchRecipe = watchRow.querySelector('#watch-ck').checked ? watchRow.querySelector('#watch-sel').value : null
  }
  watchRow.querySelector('#watch-ck').onchange = syncWatch
  watchRow.querySelector('#watch-sel').onchange = syncWatch
  sideBody.replaceChildren(watchRow, ...recipes.map(r => {
    const el = document.createElement('div'); el.className = 'recipe'
    el.innerHTML = `<code>${tool} ${r}</code><button>run</button>`
    el.querySelector('button').onclick = async ev => {
      ev.target.disabled = true; log.textContent = `running ${r}...`
      const res = await api(P('/build/' + r), { method: 'POST' })
      log.textContent = (res.ok ? '' : 'FAILED\n') + res.output
      ev.target.disabled = false
      refreshDisk()
    }
    return el
  }), log)
}

// ---------- change review (offline merge awareness) ----------
// Line-level LCS diff: returns [{type:'same'|'add'|'del', text}] ops.
function lineDiff(a, b) {
  let A = a.split('\n'), B = b.split('\n'), head = [], tail = []
  while (A.length && B.length && A[0] === B[0]) head.push({ type: 'same', text: (B.shift(), A.shift()) })
  while (A.length && B.length && A.at(-1) === B.at(-1)) tail.unshift({ type: 'same', text: (B.pop(), A.pop()) })
  // the LCS table is n*m: past a few million cells, show the change as a whole
  if (A.length * B.length > 4e6)
    return [...head, ...A.map(text => ({ type: 'del', text })), ...B.map(text => ({ type: 'add', text })), ...tail]
  return [...head, ...lcs(A, B), ...tail]
}
function lcs(A, B) {
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ type: 'same', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: A[i] }); i++ }
    else { ops.push({ type: 'add', text: B[j] }); j++ }
  }
  while (i < n) ops.push({ type: 'del', text: A[i++] })
  while (j < m) ops.push({ type: 'add', text: B[j++] })
  return ops
}

let reviewData = null
function maybeReview(before) {
  const changed = []
  const now = snapshotFiles()
  const paths = new Set([...Object.keys(before), ...Object.keys(now)])
  for (const p of paths) {
    const a = before[p] ?? '', b = now[p] ?? ''
    if (a !== b) changed.push({ path: p, before: a, after: b })
  }
  if (!changed.length) return
  reviewData = changed
  $('status').dataset.review = '1'
  openSidebar('review')
}

function renderReview() {
  if (!reviewData?.length) {
    sideBody.innerHTML = '<p class="empty">No changes to review. This appears after reconnecting if others edited while you were offline.</p>'
    return
  }
  const head = document.createElement('div')
  head.className = 'review-head'
  head.innerHTML = `<p>While you were away, ${reviewData.length} file(s) changed. Keep what others did, or revert to your offline version.</p>`
  const blocks = reviewData.map(({ path, before, after }) => {
    const el = document.createElement('div')
    el.className = 'review-file'
    const ops = lineDiff(before, after)
    const rows = ops.map(o =>
      `<div class="dl ${o.type}">${o.type === 'add' ? '+' : o.type === 'del' ? '-' : '\u00a0'} ${esc(o.text) || '&nbsp;'}</div>`).join('')
    el.innerHTML = `<div class="review-file-head"><b></b>
        <span><button class="keep">keep theirs</button><button class="revert">revert to mine</button></span></div>
      <div class="review-diff">${rows}</div>`
    el.querySelector('b').textContent = path
    el.querySelector('.keep').onclick = () => {
      reviewData = reviewData.filter(r => r.path !== path)
      if (filesMap.has(path)) openFile(path)
      renderReview()
    }
    el.querySelector('.revert').onclick = () => {
      const yt = filesMap.get(path)
      if (yt) ydoc.transact(() => { yt.delete(0, yt.length); yt.insert(0, before) })
      else if (before) filesMap.set(path, new Y.Text(before))
      reviewData = reviewData.filter(r => r.path !== path)
      renderReview()
    }
    return el
  })
  const footer = document.createElement('div')
  footer.className = 'review-foot'
  footer.innerHTML = `<button id="rev-keepall">keep all</button>`
  footer.querySelector('#rev-keepall').onclick = () => { reviewData = null; $('status').dataset.review = ''; openSidebar('comments') }
  sideBody.replaceChildren(head, ...blocks, footer)
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ---------- menubar, layout, shortcuts ----------
function applyLayout() {
  document.body.classList.toggle('no-tree', !settings.treeOpen)
  document.body.classList.toggle('no-side', !settings.sideOpen)
  // The markup ships the panel hidden so it doesn't flash before JS runs;
  // the attribute wins over the body class (display:none !important), so it
  // has to be released here or no pane can ever appear.
  $('side').hidden = !settings.sideOpen
  document.body.classList.toggle('focus', settings.focus)
  document.body.classList.toggle('dark-preview', settings.darkPreview)
  document.body.classList.toggle('sect-projects-closed', !settings.projectsOpen)
  document.body.classList.toggle('sect-files-closed', !settings.filesOpen)
  $('page').style.maxWidth = `${Math.round(820 * settings.zoom)}px`
  document.querySelectorAll('[data-check]').forEach(b =>
    b.classList.toggle('checked', !!settings[b.dataset.check]))
  saveSettings()
}
document.querySelectorAll('.sect-head[data-sect]').forEach(h => {
  h.addEventListener('click', e => {
    if (e.target.closest('button')) return
    settings[h.dataset.sect] = !settings[h.dataset.sect]
    h.querySelector('.tw').innerHTML = settings[h.dataset.sect] ? '&#9662;' : '&#9656;'
    applyLayout()
  })
})

async function renderProjects() {
  const list = await api('/projects')
  $('projects-list').replaceChildren(...list.map(({ name: n }) => {
    const a = document.createElement('a')
    a.href = `?proj=${n}${location.hash}`
    a.className = 'pnode' + (n === projName ? ' active' : '')
    a.textContent = n
    return a
  }))
}
$('proj-new-btn').onclick = async () => {
  const n = prompt('New project name ([\\w-]):')
  if (!n) return
  const r = await api(`/projects/${n}`, { method: 'POST' })
  if (r.error) return alert(r.error)
  location.search = `?proj=${n}`
}

$('zoomctl').addEventListener('click', e => {
  const z = e.target.dataset.z
  if (!z) return
  if (z === 'fit') settings.zoom = ($('preview').clientWidth - 48) / 820
  else settings.zoom = Math.min(3, Math.max(0.3, settings.zoom + (z === '+' ? 0.1 : -0.1)))
  applyLayout()
})

// Git remote: the project's durable home on a git host you control. The hub
// pushes when it goes idle and when it shuts down, so no machine here has to
// stay up for the work to survive.
async function showGitRemote() {
  const dlg = $('git'), body = $('git-body')
  body.innerHTML = '<p class="empty">loading...</p>'
  dlg.showModal()
  const render = async () => {
    const st = await api(P('/gitremote'))
    body.innerHTML = `
      <p class="fed-explain">Point this project at a repository on any git host -- GitHub, GitLab,
        Codeberg, your institution's GitLab, or a bare repo on a NAS. The working tree is pushed in
        readable form, so the paper is browsable and clonable there, alongside this hub's CRDT state
        under <code>.collab/crdt/</code>. Every hub writes only its own state file, so several hubs can
        share one remote without conflicts. Checkpoint signatures and comments travel as git notes
        (<code>refs/notes/&lt;hub&gt;/*</code>). <code>out/</code> is never pushed: each hub rebuilds it.</p>
      <label>Repository URL
        <div class="fed-row"><input id="git-url" placeholder="https://github.com/lab/paper.git" value="${st.configured ? esc(st.url) : ''}" />
        <input id="git-branch" style="flex:0 0 6rem" placeholder="main" value="${esc(st.branch || 'main')}" /></div></label>
      <p class="fed-explain">For a private repo over HTTPS, include a token
        (<code>https://user:TOKEN@host/lab/paper.git</code>) -- it is stored on this hub only, never
        committed, and shown redacted here. An SSH URL uses this hub's key instead.</p>
      <div class="fed-row"><button id="git-save">${st.configured ? 'update' : 'set remote'}</button>
        ${st.configured ? '<button id="git-sync">push now</button><button id="git-clear" class="danger">forget remote</button>' : ''}</div>
      <div class="fed-status">
        <div>this hub: <code>${esc(st.hubId || '')}</code></div>
        <div>last sync: ${st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never'}</div>
        ${st.lastError ? `<div class="git-err">${esc(st.lastError)}</div>` : ''}
      </div>`
    $('git-save').onclick = async () => {
      const r = await api(P('/gitremote'), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: $('git-url').value.trim(), branch: $('git-branch').value.trim() || 'main' }) })
      if (r.error) return alert(r.error)
      render()
    }
    const sync = $('git-sync'); if (sync) sync.onclick = async () => {
      sync.disabled = true; sync.textContent = 'pushing...'
      const r = await api(P('/gitremote/sync'), { method: 'POST' })
      if (r.error || r.ok === false) alert(r.error || r.lastError || 'push failed - check credentials and branch protection')
      render()
    }
    const clr = $('git-clear'); if (clr) clr.onclick = async () => {
      if (!confirm('Forget this remote? The project stays on this hub; the repository is untouched.')) return
      await api(P('/gitremote'), { method: 'DELETE' }); render()
    }
  }
  await render()
}

// Federation: sync this project with the same-named project on another
// self-hosted hub, over iroh. Either side pastes the other's invite.
async function showFederation() {
  const dlg = $('fed'), body = $('fed-body')
  body.innerHTML = '<p class="empty">loading...</p>'
  dlg.showModal()
  const render = async () => {
    const st = await api(P('/federation'))
    if (!st.enabled) {
      body.innerHTML = `<p class="empty">Federation is off on this hub (TYDIG_IROH=0, or the iroh
        bindings are unavailable on this platform). Everything else works; this project just lives on
        this hub alone.</p>`
      return
    }
    const pr = st.project || {}
    body.innerHTML = `
      <p class="fed-explain">Two hubs that both have a project named <b>${esc(projName)}</b> can keep it in
        sync directly, peer to peer -- through NAT, with no domain, certificate, or open port. Every hub
        keeps its own disk copy, git history, and builds. Paste the other hub's invite below, or give
        them yours. Anyone holding the invite can join, so treat it like commit access.</p>
      <label>This hub's invite for <b>${esc(projName)}</b>
        <div class="fed-row"><input id="fed-invite" readonly value="${pr.invite ? esc(pr.invite) : ''}" placeholder="press generate" />
        <button id="fed-gen">${pr.invite ? 'copy' : 'generate'}</button></div></label>
      <label>Link to another hub
        <form id="fed-link" class="fed-row"><input id="fed-paste" placeholder="tydig-fed:..." required /><button>link</button></form></label>
      <div class="fed-status">
        <div>hub id <code>${esc((st.id || '').slice(0, 20))}…</code> · relay: ${esc(st.relay)}</div>
        <div>linked hubs: ${(pr.linked || []).length}${(pr.linked || []).length ? ' · ' + pr.linked.map(l => `<code>${esc(l.ticket)}</code>`).join(' ') : ''}</div>
        <div>connected now: ${(pr.connected || []).length
          ? pr.connected.map(c => `<code>${esc(c.remoteId.slice(0, 12))}…</code> (${c.direction})`).join(' ')
          : 'none'}</div>
        ${pr.invite ? '<button id="fed-rotate" class="danger">rotate token (evicts every linked hub)</button>' : ''}
      </div>`
    $('fed-gen').onclick = async () => {
      if (!$('fed-invite').value) { const r = await api(P('/federation/invite'), { method: 'POST' }); if (r.error) return alert(r.error); return render() }
      await navigator.clipboard?.writeText($('fed-invite').value).catch(() => {})
      $('fed-gen').textContent = 'copied'; setTimeout(() => $('fed-gen').textContent = 'copy', 1200)
    }
    $('fed-link').onsubmit = async e => {
      e.preventDefault()
      const r = await api(P('/federation/link'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: $('fed-paste').value }) })
      if (r.error) return alert(r.error)
      render()
    }
    const rot = $('fed-rotate'); if (rot) rot.onclick = async () => {
      if (!confirm('Rotate the federation token? Every linked hub will be refused until re-invited.')) return
      await api(P('/federation/rotate'), { method: 'POST' }); render()
    }
  }
  await render()
  // one refresher per dialog, and none while an invite is being pasted
  clearInterval(dlg.timer)
  dlg.timer = setInterval(() => dlg.open ? $('fed-paste')?.value || render() : clearInterval(dlg.timer), 5000)
}

async function showShare() {
  const dlg = $('share')
  const body = $('share-body'), share = await api('/link')
  body.innerHTML = '<p class="empty">loading...</p>'
  dlg.showModal()
  const orgs = await api('/projects')
  const mine = orgs.find(o => o.name === projName)
  const isOwner = mine?.role === 'owner' || mine?.role === 'admin'
  const full = (await authClient.organization.getFullOrganization({ query: { organizationSlug: projName } }).catch(() => null))?.data
  const row = (who, role, act, id) => `<div class="share-row"><span>${esc(who)}</span><em>${esc(role)}</em>${
    isOwner && act && role !== 'owner' ? `<button data-${act}="${esc(id)}">${act}</button>` : ''}</div>`
  body.innerHTML = `
    <div class="share-list">
      ${(full?.members || []).map(m => row(m.user?.email || m.user?.name || m.userId, m.role, 'remove', m.id)).join('')}
      ${(full?.invitations || []).filter(i => i.status === 'pending').map(i => row(i.email, 'invited', 'cancel', i.id)).join('')}
    </div>
    ${isOwner ? `<form id="share-add"><input type="email" id="share-email" placeholder="collaborator@email" required /><button>add</button></form>
      <p class="hint">An address with no account here is invited: it can then sign up, and the project is waiting.</p>`
      : '<p class="hint">Only the owner can add collaborators.</p>'}
    ${share.link ? `<p class="hint">They open this in any browser, nothing to install:</p><input readonly value="${esc(share.link)}">` : ''}`
  body.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this collaborator? They lose access at once.')) return
    const r = await api(P('/members/' + b.dataset.remove), { method: 'DELETE' })
    r.error ? alert(r.error) : showShare()
  })
  body.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () =>
    authClient.organization.cancelInvitation({ invitationId: b.dataset.cancel }).then(showShare))
  if (isOwner) $('share-add').onsubmit = async e => {
    e.preventDefault()
    const r = await api(P('/members'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('share-email').value }) })
    if (r.error) return alert(r.error)
    showShare()
  }
}

const actions = {
  'new-file': newFile,
  upload: () => uploadTo(),
  projects: openPicker,
  checkpoint: async () => {
    const message = prompt('Checkpoint name:')
    if (message == null) return
    // Sign the checkpoint with this device's post-quantum key; fall back to
    // an unsigned checkpoint if signing is unavailable.
    let signed = {}
    try {
      await registerDeviceKey(api, me.id)
      const files = [...filesMap.entries()].filter(([p]) => okPath(p) && !GEN.test(p)).map(([p, t]) => [p, t.toString()])
      signed = await signCheckpoint({ user: me.id, project: projName, message, files })
    } catch (e) { console.warn('checkpoint will be unsigned:', e) }
    await api(P('/checkpoint'), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, ...signed }) })
    if (sidebarMode === 'history') renderHistory()
  },
  'export-pdf': exportPdf,
  undo: () => undoManagers.get(currentPath)?.undo(),
  redo: () => undoManagers.get(currentPath)?.redo(),
  comment: addComment,
  'toggle-tree': () => { settings.treeOpen = !settings.treeOpen; applyLayout() },
  'toggle-side': () => { settings.sideOpen = !settings.sideOpen; if (settings.sideOpen && !sidebarMode) sidebarMode = 'comments', renderComments(); applyLayout() },
  focus: () => { settings.focus = !settings.focus; applyLayout() },
  'dark-preview': () => { settings.darkPreview = !settings.darkPreview; applyLayout() },
  comments: () => openSidebar('comments'),
  history: () => openSidebar('history'),
  build: () => openSidebar('build'),
  review: () => openSidebar('review'),
  vim: () => { settings.vim = !settings.vim; applyLayout(); view?.dispatch({ effects: vimComp.reconfigure(settings.vim ? vim() : []) }) },
  lsp: () => { settings.lsp = !settings.lsp; lspDead = false; lspClient = null; applyLayout(); if (currentPath) openFile(currentPath) },
  share: showShare,
  federation: showFederation,
  gitremote: showGitRemote,
  signout: async () => { await authClient.signOut(); location.search = '' },
  password: async () => {
    const currentPassword = prompt('Current password:'), newPassword = currentPassword && prompt('New password (8+ characters):')
    if (!newPassword) return
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
    alert(error ? error.message : 'Password changed; other sessions are signed out.')
  },
  'quick-open': () => quickOpen(),
  shortcuts: () => alert(
`Ctrl-P    open file (fuzzy)
Ctrl-S    checkpoint
Alt-N     new file
Alt-E     export preview PDF
Ctrl-Alt-M  comment on selection
Ctrl-Z / Ctrl-Shift-Z  undo / redo (own edits only)

Alt-1     file tree
Alt-2     side panel
Alt-0     focus mode (toggle works while typing)
Alt-C     comments   Alt-H  history   Alt-B  build

Vim mode: Settings > Vim (then vim keys apply inside the editor)`),
}
document.querySelectorAll('#menubar [data-act]').forEach(b => {
  b.addEventListener('click', () => { actions[b.dataset.act]?.(); b.closest('.dropdown').classList.remove('open') })
})
document.querySelectorAll('#menubar .menu > button').forEach(b => {
  b.addEventListener('click', e => {
    const dd = b.nextElementSibling
    const was = dd.classList.contains('open')
    document.querySelectorAll('#menubar .dropdown.open').forEach(d => d.classList.remove('open'))
    if (!was) dd.classList.add('open')
    e.stopPropagation()
  })
})
document.addEventListener('click', () => document.querySelectorAll('#menubar .dropdown.open').forEach(d => d.classList.remove('open')))

// Capture phase: fires before CodeMirror sees the key, so shortcuts work
// while typing in the editor (essential for exiting focus mode).
const KEYMAP = {
  'A-Digit1': 'toggle-tree', 'A-Digit2': 'toggle-side', 'A-Digit0': 'focus',
  'A-KeyB': 'build', 'A-KeyH': 'history', 'A-KeyC': 'comments',
  'A-KeyN': 'new-file', 'A-KeyE': 'export-pdf',
  'C-KeyP': 'quick-open', 'C-KeyS': 'checkpoint', 'C-A-KeyM': 'comment',
}
document.addEventListener('keydown', e => {
  const combo = (e.ctrlKey || e.metaKey ? 'C-' : '') + (e.altKey ? 'A-' : '') + (e.shiftKey ? 'S-' : '') + e.code
  const act = KEYMAP[combo]
  if (!act) return
  e.preventDefault(); e.stopPropagation()
  actions[act]?.()
}, true)
$('focus-exit').onclick = () => actions.focus()
$('bar-comment').onclick = () => addComment()
$('bar-build').onclick = () => openSidebar('build')
$('tgl-tree').onclick = () => actions['toggle-tree']()
$('tgl-side').onclick = () => actions['toggle-side']()

// quick-open (Ctrl-P): subsequence filter over all project files
function quickOpen() {
  const dlg = $('qo'), input = $('qo-input'), list = $('qo-list')
  const all = [...new Set([...filesMap.keys(), ...diskFiles.map(f => f.path)])].sort()
  let sel = 0
  const fuzzy = (q, s) => {
    let i = 0
    for (const ch of s.toLowerCase()) if (ch === q[i]) i++
    return i === q.length
  }
  const render = () => {
    const q = input.value.toLowerCase()
    const hits = all.filter(p => fuzzy(q, p)).slice(0, 12)
    sel = Math.min(sel, Math.max(0, hits.length - 1))
    list.replaceChildren(...hits.map((p, i) => {
      const d = document.createElement('div')
      d.textContent = p
      d.className = i === sel ? 'sel' : ''
      d.onclick = () => { dlg.close(); filesMap.has(p) ? openFile(p) : openDisk(p) }
      return d
    }))
  }
  input.value = ''; sel = 0; render()
  input.oninput = () => { sel = 0; render() }
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel++; render(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault() }
    else if (e.key === 'Enter') { list.children[sel]?.click(); e.preventDefault() }
  }
  dlg.showModal(); input.focus()
}

// ---------- boot ----------
applyLayout()
if (settings.sideOpen) openSidebar('comments')
renderProjects()
provider.on('synced', () => {
  refreshDisk()
  renderMainSel()
  if (!currentPath) {
    const last = localStorage['last:' + projName]
    const first = (last && filesMap.has(last)) ? last
      : filesMap.has('main.typ') ? 'main.typ'
      : [...filesMap.keys()].sort().find(p => p.endsWith('.typ'))
    if (first) openFile(first)
  }
  scheduleCompile()
})
