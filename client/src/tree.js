// The file tree: shared text and files on disk, who has which open; upload,
// archive import, new file, rename, delete; and quick open (Ctrl-P).
import * as Y from 'yjs'
import { $, el, dot, esc, api, del, settings, phone, download, asText, projName, P, rawUrl, choose }
  from './util.js'
import { ydoc, files, comments, meta, provider, okPath, GEN, setText, tags, tag, TAGS } from './doc.js'
import { path, open, openFile, reveal } from './editor.js'
import { fileComments, rel } from './comments.js'
import { scheduleCompile } from './preview.js'
import { checklistBadge } from './panels.js'
import { ARCHIVE, unpackInto } from './dialogs.js'
import { applyLayout } from './menu.js'

export let disk = [] // [{ path, size, mtime }]: files on the hub's disk
export async function refreshDisk() { // a failed listing keeps the last good one
  const d = await api(P('/files')).catch(() => null)
  if (Array.isArray(d)) disk = d
  renderTree(); scheduleCompile()
}
// the hub bumps meta.diskRev whenever the disk changes (builds, a shell, git)
let metaT
meta.observe(() => { clearTimeout(metaT); metaT = setTimeout(refreshDisk, 200) })
files.observe(() => renderTree())
// redraw when someone opens another file, not on every cursor move
let where = ''
provider.awareness.on('change', () => {
  const s = provider.awareness.getStates(), w = [...s].map(([id, x]) => `${id}:${x.file}`).join()
  $('peers').textContent = `${s.size} online`
  if (w !== where) { where = w; renderTree() }
})

const paths = () => [...new Set([...files.keys(), ...disk.map(f => f.path)])]
const picked = new Set() // Ctrl/Cmd-click picks several; x then deletes them all
const openDirs = new Set(JSON.parse(localStorage['dirs:' + projName] || '[]'))
const saveDirs = () => localStorage['dirs:' + projName] = JSON.stringify([...openDirs])
const btn = (cls, title, text) => `<button class="${cls}" title="${title}">${text}</button>`
const OPS = { file: btn('get', 'download', '&darr;') + btn('rn', 'rename', '~') + btn('tg', 'tags: AI-generated, read-only', '#'),
  dir: btn('addf', 'new file here', '+') + btn('upd', 'upload here', 'up') }
const badge = p => Object.keys(tags(p)).map(k => `<span class="ftag ${k}" title="${TAGS[k]}">${k === 'read-only'
  ? '&#128274;' : 'AI'}</span>`).join('')
const row = (cls, p, depth, twisty, dots = '') => `<div class="tnode ${cls}" title="${esc(p)}" ` +
  `style="padding-left:${0.5 + depth * 0.85}rem">${twisty}<span class="fname">${esc(p.split('/').pop())}` +
  `</span>${cls === 'dir' ? '' : badge(p)}${dots}<span class="ops">${OPS[cls === 'dir' ? 'dir' : 'file']}` +
  `${btn('del', 'delete', 'x')}</span></div>`

export function renderTree() {
  const here = {}, root = { dirs: new Map(), files: [] }, html = []
  for (const [, s] of provider.awareness.getStates()) if (s.file && s.user) (here[s.file] ??= []).push(s.user)
  for (const p of paths()) {
    let n = root
    for (const d of p.split('/').slice(0, -1))
      n = n.dirs.get(d) ?? n.dirs.set(d, { dirs: new Map(), files: [] }).get(d)
    n.files.push(p)
  }
  const walk = (n, prefix, depth) => {
    for (const [d, sub] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const full = prefix + d, on = openDirs.has(full)
      html.push(row('dir', full, depth, `<span class="tw">${on ? '&#9662;' : '&#9656;'}</span>`))
      if (on) walk(sub, full + '/', depth + 1)
    }
    for (const p of n.files.sort()) html.push(row([files.has(p) ? 'text' : 'bin', p === path && 'active',
      picked.has(p) && 'picked'].filter(Boolean).join(' '), p, depth, '',
      `<span class="dots">${(here[p] ?? []).map(peer).join('')}</span>`))
  }
  walk(root, '', 0)
  $('tree').innerHTML = html.join('')
  checklistBadge()
}
const peer = u => dot(u.color, u.name).outerHTML

const tree = $('tree')
tree.onclick = e => {
  const r = e.target.closest('.tnode'), b = e.target.closest('button')?.className, p = r?.title
  if (!r) return
  if (r.classList.contains('dir')) {
    if (b === 'addf') return newFile(p + '/')
    if (b === 'upd') return uploadTo(p)
    if (b === 'del') return remove(paths().filter(q => q.startsWith(p + '/')))
    openDirs.has(p) ? openDirs.delete(p) : openDirs.add(p)
    return saveDirs(), renderTree()
  }
  if (b === 'get') return download(rawUrl(p), p)
  if (b === 'rn') return rename(p)
  if (b === 'tg') return tagMenu(p)
  if (b === 'del') return remove(picked.has(p) ? [...picked] : [p])
  if (e.ctrlKey || e.metaKey) { picked.has(p) ? picked.delete(p) : picked.add(p); return renderTree() }
  picked.clear(); open(p)
  if (phone() && !/\.pdf$/i.test(p)) { settings.m = 'edit'; applyLayout() }
}
tree.onkeydown = e => e.key === 'Delete' && picked.size && remove([...picked])
// dropped on a folder, files go into it; anywhere else, to the top
const hover = e => {
  e.preventDefault()
  const d = e.type === 'dragover' && e.target.closest('.dir')
  tree.querySelectorAll('.dropping').forEach(x => x !== d && x.classList.remove('dropping'))
  d?.classList.add('dropping')
  return d
}
tree.ondragover = tree.ondragleave = hover
tree.ondrop = e => { hover(e); upload(e.dataTransfer.files, e.target.closest('.dir')?.title ?? '') }

// a file's tags, each to set or unset
export const tagMenu = p => choose(Object.entries(TAGS).map(([k, name]) => {
  const on = !!tags(p)[k]
  return { label: k === 'read-only' ? on ? 'Make editable' : 'Make read-only (a reference)'
    : on ? 'Not AI-generated' : 'Mark as AI-generated', hint: on ? `${name}: yes` : '', run: () => tag(p, k, !on) }
}), `tags of ${p}`)
const locked = ps => ps.filter(p => tags(p)['read-only'])

async function remove(ps) {
  if (locked(ps).length) return alert(`Read-only, so kept: ${locked(ps).join(', ')}. Make it editable first (tag).`)
  if (!ps.length || !confirm(ps.length > 1 ? `Delete these ${ps.length} files?\n${ps.join('\n')}`
    : `Delete ${ps[0]}?`)) return
  const gone = ps.filter(p => !files.has(p))
  ydoc.transact(() => ps.forEach(p => files.delete(p)))
  await Promise.all(gone.map(p => del(P('/raw/' + p)).catch(() => {})))
  picked.clear(); refreshDisk()
}

// Text outside build output goes into the CRDT (editable, synced); anything
// else (images, PDFs, big data) is a file on disk; an archive, if wanted, is
// unpacked into the project.
async function upload(list, dir) {
  const failed = []
  for (const f of list) {
    if (ARCHIVE.test(f.name) && confirm(`Unpack ${f.name} into ${dir || 'this project'}? Each file in it that ` +
      'differs is updated, live; none is deleted, and History can undo it. (Cancel uploads it as a file.)')) {
      await unpackInto(projName, f, dir); continue
    }
    const p = (dir ? dir + '/' : '') + f.name.replace(/[^\w.@ -]/g, '_'), t = files.get(p)
    const s = okPath(p) && !GEN.test(p) ? await asText(f) : null
    if (s != null) { t ? setText(t, s) : files.set(p, new Y.Text(s)); continue }
    const r = await fetch(rawUrl(p), { method: 'PUT', body: f })
    if (!r.ok) failed.push(`${p}: ` + (r.status === 413 ? 'larger than 50 MB'
      : (await r.json().catch(() => ({}))).error || r.statusText))
  }
  dir.split('/').forEach((_, i, a) => a[0] && openDirs.add(a.slice(0, i + 1).join('/'))) // show where it went
  saveDirs(); refreshDisk()
  if (failed.length) alert(`Not uploaded:\n${failed.join('\n')}`)
}
export function uploadTo(dir = '') { $('upload-input').dataset.dir = dir; $('upload-input').click() }
$('upload-input').onchange = async e => {
  // copied, then cleared: the same file can be picked again
  const list = [...e.target.files]
  const dir = e.target.dataset.dir || prompt('Upload into directory (empty for root):', 'figures')
  e.target.value = ''; e.target.dataset.dir = ''
  if (dir != null) await upload(list, dir.replace(/^\/+|\/+$/g, ''))
}

const badNew = p => !okPath(p) ? 'Bad path.'
  : GEN.test(p) ? `${p.split('/')[0]}/ is build output: text there is never saved.`
  : files.has(p) ? 'Target exists.' : null
export function newFile(prefix = '') {
  const p = prompt('Path (dirs auto-created), e.g. chapters/01-intro.typ:', prefix)?.replace(/^\/+/, '')
  if (!p) return
  const bad = !files.has(p) && badNew(p)
  if (bad) return alert(bad)
  if (!files.has(p)) files.set(p, new Y.Text(''))
  openFile(p)
}
function rename(p) {
  if (locked([p]).length) return alert(`${p} is read-only. Make it editable first (tag).`)
  const yt = files.get(p)
  if (!yt) return alert('Disk-only files: move via shell or a recipe.')
  const np = prompt('New path:', p)?.replace(/^\/+/, '')
  if (!np || np === p) return
  const bad = badNew(np)
  if (bad) return alert(bad)
  const moved = fileComments(p), nyt = new Y.Text(yt.toString())
  ydoc.transact(() => { // with its comments, re-anchored
    files.set(np, nyt); files.delete(p)
    for (const { id, from, to, ...c } of moved)
      comments.set(id, { ...c, file: np, anchor: rel(nyt, from, 0), head: rel(nyt, to, -1) })
  })
  if (path === p) openFile(np)
}

// Ctrl-P: any file, by letters of its path in order
export const quickOpen = () => choose(paths().sort().map(p => ({ label: p, run: () => open(p) })),
  'open a file...')
// Mod-Shift-F, Space f w, :grep: every line of every file that matches, as typed
// (a regular expression; smart case, as rg); Enter opens it with the match selected
export const grep = (q = '') => choose(q => {
  let re, out = []
  try { re = q && new RegExp(q, /[A-Z]/.test(q) ? '' : 'i') } catch {}
  if (re) for (const [p, y] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
    let at = 0
    for (const [i, l] of y.toString().split('\n').entries()) {
      const m = out.length < 50 && re.exec(l), from = at + m?.index
      if (m) out.push({ label: l.trim().slice(0, 100), hint: `${p}:${i + 1}`, run: () => reveal(p, from, from + m[0].length) })
      at += l.length + 1
    }
  }
  return out
}, 'search every file (a regular expression)...', q)
