// The side panel, and its panes but comments and the Discussion (comments.js),
// citations (cite.js) and spelling (spell.js): history and checkpoints, builds (and watch), the
// grant checklist, the template switch, and changes made while you were away.
import * as Y from 'yjs'
import { diffArrays, diffWordsWithSpace } from 'diff'
import { renderCite, citeAt, bibOf } from './cite.js'
import { parseBib } from '../../server/refs.mjs'
import { prose, readAi, aiPct } from './surprise.js'
import { renderSpelling } from './spell.js'
import { $, el, esc, api, post, toast, settings, phone, me, projName, P, rawUrl, choose, icon, assist } from './util.js'
import { files, meta, provider, local, okPath, GEN, setText, AWAY } from './doc.js'
import { view, path, open, openFile, reveal } from './editor.js'
import { typeset, aiMarks } from './preview.js'
import { renderComments, renderChat, unseen } from './comments.js'
import { disk, refreshDisk } from './tree.js'
import { applyLayout } from './menu.js'

export let mode = null
let citeCtx = {}
const panes = () => ({ comments: renderComments, chat: renderChat, cite: b => renderCite(b, citeCtx),
  history: renderHistory, build: renderBuild, checklist: renderChecklist, template: renderTemplate,
  review: renderReview, spelling: b => renderSpelling(b, { files, open: reveal }), aicheck: renderAiCheck })
export function openSidebar(m) {
  mode = m; settings.sideOpen = true
  if (phone()) settings.m = 'side'
  applyLayout(); tabs()
  redraw(m)
}
// the rail: a pane's button opens it, or closes it if open; comments and
// the Discussion count what is new. The panel is titled by its pane.
const TITLES = { comments: 'Comments', chat: 'Discussion', history: 'History', build: 'Build', checklist: 'Checklist',
  aicheck: 'AI check', cite: 'Cite', review: 'Changes while away', spelling: 'Spelling and grammar', template: 'Template' }
export function tabs() {
  const n = unseen()
  for (const b of $('rail').querySelectorAll('[data-pane]')) {
    const m = b.dataset.pane, badge = b.querySelector('.badge')
    b.classList.toggle('on', settings.sideOpen && m === mode)
    if (m in n) { badge.hidden = !n[m]; badge.textContent = n[m] }
  }
  $('side-title').textContent = TITLES[mode] ?? ''
}
$('rail').addEventListener('click', e => {
  const m = e.target.closest('[data-pane]')?.dataset.pane
  if (m) settings.sideOpen && mode === m && !phone() ? toggleSide() : openSidebar(m)
})
// the pane again, if it is the one open; a slow one checks body.dataset.pane before it fills in.
// A composer being typed in keeps the focus and the caret.
export function redraw(m) {
  if (mode !== m) return
  const b = $('side-body'), f = document.activeElement, k = b.contains(f) ? f.dataset.re : null, at = f?.selectionStart
  b.dataset.pane = m; panes()[m](b)
  const t = k != null && b.querySelector(`textarea[data-re="${CSS.escape(k)}"]`)
  if (t) { t.focus(); t.setSelectionRange(at, at) }
}
export function toggleSide() {
  if (!settings.sideOpen) return openSidebar(mode || 'comments')
  settings.sideOpen = false; applyLayout(); tabs()
}
$('side-close').onclick = () => { settings.sideOpen = false; mode = null; if (settings.m === 'side') settings.m = 'edit'; applyLayout(); tabs() }

// ---- AI check ----
// The document as typeset, what a reviewer reads (the computed numbers, the
// template's words, an #if's branch taken), read by MELD: its AI-likeness,
// how many sentences fall in each band, and the most AI-like, each a click
// from where it was written.
let aiReport = null
const BANDS = [[0.7, 'blocked out (70% and up)'], [0.4, 'strong (40 to 70%)'], [0.08, 'tinted (8 to 40%)'], [0, 'typical']]
const chip = p => el('span', { className: `ai-chip${p >= 0.7 ? ' ai-top' : p >= 0.4 ? ' ai-mid' : ''}`,
  style: `--ai:${Math.min(1, 0.22 + 0.85 * p).toFixed(2)}`, textContent: `${Math.round(100 * p)}%` })
// where a typeset sentence was written: its words in order in a file's prose;
// else its first or last five (a computed number, a footnote's mark between)
const source = (text, prs) => {
  const w = text.match(/[\p{L}\p{N}]+/gu) || []
  for (const q of [w, w.slice(0, 5), w.slice(-5)]) {
    const re = q.length > 2 && new RegExp(`(?<![\\p{L}\\p{N}])${q.join('[^\\p{L}\\p{N}]+')}`, 'u')
    for (const [file, pr] of re ? prs : []) {
      const m = re.exec(pr.text)
      if (m) return [file, pr.at[m.index], pr.at[m.index + m[0].length - 1] + 1]
    }
  }
}
async function renderAiCheck(body) {
  const engine = settings.scope?.url ? { url: settings.scope.url } : (await assist).surprise ? { hub: `/api${P('/surprise')}` } : null
  if (!engine) return body.replaceChildren(el('p', { className: 'empty', textContent: 'No AI detector here: ' +
    'Settings › Surprise overlay, with a Perplexiscope engine on this machine, or a hub that runs one.' }))
  const status = el('p', { className: 'hint' }), main = $('main-sel').value
  const go = el('button', { className: 'go', textContent: aiReport ? 'Check again' : `Check ${main} as typeset`, onclick: async () => {
    go.disabled = true; status.textContent = `typesetting ${main}, then reading it…`
    try {
      const { text, error } = await typeset(main)
      if (error) throw new Error(error)
      const a = await readAi(engine, text)
      if (!a) throw new Error('this engine runs no AI detector')
      aiReport = { file: main, a, sents: a.sents.filter(x => x.s != null).map(x =>
        ({ p: aiPct(x.tail), text: text.slice(x.s, x.e).replace(/\s+/g, ' ').trim() })) }
    } catch (e) { aiReport = { file: main, error: e.message } }
    redraw('aicheck')
    // on the preview too: each sentence where it was written
    const prs = [...files].filter(([p]) => p.endsWith('.typ')).map(([p, t]) => [p, prose(t.toString())]), by = new Map()
    for (const x of aiReport.sents || []) {
      const at = source(x.text, prs)
      if (at) (by.get(at[0]) ?? by.set(at[0], []).get(at[0])).push([at[1], at[2], x.p])
    }
    by.forEach((l, f) => aiMarks(f, l))
  } })
  const r = aiReport, all = r?.sents || []
  const prs = r ? [...files].filter(([p]) => p.endsWith('.typ')).map(([p, t]) => [p, prose(t.toString())]) : []
  body.replaceChildren(el('p', { className: 'hint', textContent: 'How AI-like each sentence of the PDF reads to MELD, ' +
    'measured against human writing: what a reviewer might flag. The overlay (Settings) shows it as you write.' }),
  go, status, ...!r ? [] : [
    el('div', { className: 'ai-bands' }, ...BANDS.map(([lo, name], i) => {
      const n = all.filter(s => s.p >= lo && (i === 0 || s.p < BANDS[i - 1][0])).length
      return el('div', {}, lo ? chip(lo + 0.01) : el('span', { className: 'ai-chip', textContent: '·' }), ` ${n} ${name}`)
    })),
    el('p', { className: 'cfile', textContent: r.error ? `${r.file}: ${r.error}`
      : `${r.file}: ${r.a.words < 100 ? 'too short to judge as a whole' : `AI-likeness ${Math.round(100 * aiPct(r.a.tail))}% as a whole`}` }),
    ...all.filter(s => s.p >= 0.08).sort((a, b) => b.p - a.p).slice(0, 30).map(s => {
      const at = source(s.text, prs)
      return el('div', { className: 'ai-row', onclick: () => at ? reveal(...at) : toast('typeset by code: no file spells it out') }, chip(s.p),
        el('span', {}, s.text.length > 180 ? s.text.slice(0, 180) + '…' : s.text, el('small', { textContent: at?.[0] ?? 'typeset by code' })))
    }),
    all.length && !all.some(s => s.p >= 0.08) ? el('p', { className: 'empty', textContent: 'Every sentence reads as typical of human writing.' }) : '',
  ])
}

// Cite: papers for the selection, alone or steered by the file's topic; the
// citation goes after it
export function cite(alone) {
  const s = view?.state.selection.main, sel = s && !s.empty && view.state.sliceDoc(s.from, s.to)
  const typ = path?.endsWith('.typ'), text = t => typ ? prose(t).text : t
  citeCtx = { files, view: () => view, current: () => path, file: path, at: sel ? s.to : undefined,
    query: sel ? text(sel) : '', context: sel && !alone ? text(view.state.doc.toString()) : '' }
  openSidebar('cite')
}
// a reference already in the bibliography, found by any of its words
export function citeFromBib() {
  if (!view || !path?.endsWith('.typ')) return toast('open the .typ file to cite in, and select where')
  const s = view.state.selection.main, entries = parseBib(files.get(bibOf(files))?.toString() || '')
  if (!entries.length) return toast(`no references in ${bibOf(files)} yet: find papers instead`)
  choose(entries.map(e => ({ label: `${e.fields.title || e.key} · ${(e.fields.author || '').split(/,| and /)[0]} ${
    e.fields.year || ''}`, hint: `@${e.key}`, run: () => { citeAt(view, e.key, s?.to); view.focus() } })),
  `cite from ${bibOf(files)}: a title, author, year or key`)
}
// the selection's bubble: comment, or cite, which asks how
export function citeBubble(dom) {
  const b = (i, text, small, onclick) => el('button', { onclick, onmousedown: e => e.preventDefault() },
    icon(i), el('span', {}, text, el('small', { textContent: small })))
  dom.replaceChildren(el('h4', { textContent: 'Cite the selection' }),
    b('book', 'From the bibliography…', `search ${bibOf(files)}: title, author, year, key`, citeFromBib),
    b('context', 'Find papers, in context', "the selection, steered by this file's topic", () => cite()),
    b('search', 'Find papers for this text alone', 'its words only', () => cite(true)))
  dom.classList.add('open')
}

// ---- history ----
// Ctrl-S: a commit, signed with this device's post-quantum key (unsigned if
// that fails), pushed to the git remote if there is one
export async function checkpoint(message = prompt('Checkpoint name:')) {
  if (message == null) return
  toast('saving&hellip;', true, 0)
  let signed = {}
  try {
    const { registerDeviceKey, signCheckpoint } = await import('./prov.js')
    await registerDeviceKey(api, me.id)
    const texts = [...files].filter(([p]) => okPath(p) && !GEN.test(p)).map(([p, t]) => [p, t.toString()])
    signed = await signCheckpoint({ user: me.id, project: projName, message, files: texts })
  } catch (e) { console.warn('checkpoint will be unsigned:', e) }
  const r = await post(P('/checkpoint'), { message, ...signed }).catch(() => ({ error: 'the hub did not ' +
    'answer. Your edits are kept in this browser and reach the hub when it is back; save again then' }))
  const push = r.pushed
  toast(r.error ? `not saved: ${esc(r.error)}` : !push ? 'saved (committed; no git remote to push to)'
    : push.ok ? 'saved and pushed' : push.ok == null ? 'saved; the push is still running (slow remote)'
    : `saved, but the push failed: ${esc(push.error || '')}`, !r.error && push?.ok !== false)
  redraw('history')
}
// the hub could not commit (meta.commitError): said once, until it can again
let failed = null
meta.observe(() => {
  const e = meta.get('commitError')
  if (e && e !== failed) toast(`edits are kept, but not committed: ${esc(e)}`, false, 0)
  failed = e
})
const badge = v => !v ? '' : v.verified ? `<span class="prov ok" title="ML-DSA-65 signature by a key ` +
  `registered to ${esc(v.by ?? 'this account')}; file hashes match (key ${esc(v.keyId)})">signed by ` +
  `${esc(v.by ?? '?')} &#10003;</span>` : '<span class="prov warn" title="signature present but not verifiable">unverified</span>'
const sum = (fs, k) => fs.reduce((n, f) => n + f[k], 0)
const what = fs => !fs.length ? 'no changes' : `<span title="${esc(fs.map(f => `${f.path}  +${f.add} -${f.del}`)
  .join('\n'))}">${fs.length === 1 ? esc(fs[0].path) : fs.length + ' files'} <ins>+${sum(fs, 'add')}</ins> ` +
  `<del>&minus;${sum(fs, 'del')}</del></span>`
const commit = c => `<div class="commit${c.message.startsWith('checkpoint') ? ' checkpoint' : ''}">` +
  `<code>${esc(c.hash)}</code><span>${esc(c.message)} ${badge(c.provenance)}</span>` +
  `<div class="who">${esc([c.author, ...c.coauthors].join(', '))} &middot; ${what(c.files)}</div>` +
  `<time>${new Date(c.date).toLocaleString()}</time><button data-hash="${esc(c.hash)}">restore</button></div>`
// a run of autosaves, folded into one: who, what (each file's lines summed), when
const folded = cs => {
  const by = [...new Set(cs.flatMap(c => [c.author, ...c.coauthors]))], fs = new Map()
  for (const f of cs.flatMap(c => c.files)) { const g = fs.get(f.path) ?? { path: f.path, add: 0, del: 0 }; g.add += f.add; g.del += f.del; fs.set(f.path, g) }
  const t = d => new Date(d).toLocaleString()
  return `<details class="autos"><summary><span>${cs.length} autosaves</span><div class="who">${esc(by.join(', '))} &middot; ` +
    `${what([...fs.values()])}</div><time>${t(cs.at(-1).date)} &ndash; ${t(cs[0].date)}</time></summary>${cs.map(commit).join('')}</details>`
}
async function renderHistory(body) {
  const log = await api(P('/history'))
  if (mode !== 'history') return // another pane was opened meanwhile
  const runs = [] // the log, each run of autosaves one entry
  for (const c of log) c.message.startsWith('autosave') && runs.at(-1)?.[0].message.startsWith('autosave') ? runs.at(-1).push(c) : runs.push([c])
  body.innerHTML = runs.map(r => r.length > 1 ? folded(r) : commit(r[0])).join('') ||
    '<p class="empty">No commits yet. Edits are kept at once, and committed when editing pauses.</p>'
  body.querySelectorAll('[data-hash]').forEach(b => b.onclick = () => confirm(`Restore ${b.dataset.hash}? ` +
    'Applies live for everyone; restore a later commit to go back.') && post(P('/restore/' + b.dataset.hash)))
}

// ---- build ----
// Recipes run in the hub's sandbox; watch reruns one when data/ or scripts/ change.
let watch = null, watching = false, watchT
const touched = (evs, re) => evs.some(e => (e.target === files ? [...e.keysChanged] : e.path.slice(0, 1))
  .some(p => re.test(p)))
files.observeDeep(evs => {
  if (!watch || !touched(evs, /^(data|scripts)\//)) return
  clearTimeout(watchT)
  watchT = setTimeout(async () => {
    if (watching) return
    watching = true; await post(P('/build/' + watch)); watching = false
    refreshDisk()
  }, 800)
})
async function renderBuild(body) {
  const [recipes, info] = await Promise.all([api(P('/recipes')), api(P('/info')).catch(() => ({}))])
  if (mode !== 'build') return
  if (recipes.error) return body.innerHTML = `<p class="empty">${esc(recipes.error)}</p><p class="empty">` +
    'The live preview does not need builds; recipes are for figures, scripts, and final PDFs.</p>'
  const tool = esc(info.tool || 'make'), pick = watch || (recipes.includes('analysis') ? 'analysis' : 'figures')
  body.innerHTML = '<div class="recipe"><label title="rerun when data/ or scripts/ change">' +
    `<input type="checkbox" id="watch-ck"${watch ? ' checked' : ''}> watch</label><select id="watch-sel">` +
    recipes.map(r => `<option${r === pick ? ' selected' : ''}>${esc(r)}</option>`).join('') + '</select></div>' +
    recipes.map(r => `<div class="recipe"><code>${tool} ${esc(r)}</code>` +
      `<button data-r="${esc(r)}">run</button></div>`).join('') + '<pre class="buildlog"></pre>'
  const log = body.querySelector('.buildlog'), ck = $('watch-ck'), sel = $('watch-sel')
  ck.onchange = sel.onchange = () => watch = ck.checked ? sel.value : null
  body.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    b.disabled = true; log.textContent = `running ${b.dataset.r}...`
    const r = await post(P('/build/' + b.dataset.r))
    log.textContent = (r.ok ? '' : 'FAILED\n') + r.output
    b.disabled = false; refreshDisk()
  })
}

// ---- checklist ----
// A project with a package.yaml (the grant templates) lists every component
// its application needs: each is here or not, live, and a missing upload goes
// straight to where it belongs. (lib/package.typ expands `each:` alike.)
let parseYaml = null // yaml, loaded once a project has a package.yaml
function checklist() {
  const pkg = files.get('package.yaml')
  if (!pkg) return null
  if (!parseYaml) return import('yaml').then(m => { parseYaml = m.parse; checklistBadge() }), null
  try {
    const G = parseYaml(files.get('grant.yaml')?.toString() || '') || {}
    const key = p => p.name.split(' ').pop().toLowerCase(), here = [...files.keys(), ...disk.map(f => f.path)]
    const glob = g => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
    return (parseYaml(pkg.toString())?.items || []).flatMap(i => i.each !== 'investigators' ? [i]
      : (G.investigators || []).map(p => ({ ...i, id: `${i.id}-${key(p)}`, name: `${i.name}: ${p.name}`,
        file: i.file.replace('{key}', key(p)) })))
      .map(i => ({ ...i, when: i.when || 'always', have: i.file && here.filter(f => glob(i.file).test(f)) }))
  } catch (e) {
    return [{ name: `package.yaml or grant.yaml does not parse: ${e.message}`, when: 'always', have: [] }]
  }
}
const NEEDED = { always: 'required', applicable: 'if applicable', jit: 'just-in-time',
  resubmission: 'resubmissions', revision: 'revisions', renewal: 'renewals' }
const upload = file => el('input', { type: 'file', accept: /\.\w+$/.exec(file)?.[0] || '', onchange: async e => {
  const r = await fetch(rawUrl(file.replace('*', 'upload')), { method: 'PUT', body: e.target.files[0] })
  r.ok ? refreshDisk() : alert(`upload failed: ${(await r.json().catch(() => ({}))).error || r.status}`)
} }).click()
const item = i => {
  const built = i.file?.startsWith('out/'), ok = i.have?.length, need = i.when === 'always'
  const acts = ok ? [el('button', { textContent: 'open', onclick: () => open(i.have[0]) })]
    : !i.file || built ? [] : [/^https?:/.test(i.from || '')
      ? el('a', { href: i.from, target: '_blank', rel: 'noopener', textContent: 'get it' }) : '',
    el('button', { textContent: 'upload', onclick: () => upload(i.file) })]
  return el('div', { className: 'check' + (ok ? ' ok' : need && i.file ? ' missing' : '') },
    el('span', { className: 'mark', textContent: !i.file ? 'form' : ok ? '✓' : need ? '✗' : '–' }),
    el('span', {}, el('b', { textContent: i.name + (i.limit ? ` (${i.limit})` : '') }),
      el('small', { textContent: `${NEEDED[i.when] || i.when} · ` +
        (!i.file ? i.from || 'an online form' : built && !ok ? 'build it: make' : i.file) })),
    el('span', { className: 'act' }, ...acts))
}
function renderChecklist(body) {
  body.replaceChildren(el('p', { className: 'hint', textContent: 'Everything the application needs ' +
    '(package.yaml). Build "all" for what is made here, "full" for the whole application in one PDF.' }),
  ...(checklist() || []).map(item))
}
// the rail's count: required components that are here, of all required
export function checklistBadge() {
  const items = checklist(), b = $('rail').querySelector('[data-pane=checklist]')
  if (b.hidden = !items) return
  const need = items.filter(i => i.when === 'always' && i.file), have = need.filter(i => i.have?.length).length
  b.querySelector('.badge').textContent = `${have}/${need.length}`
  b.title = `Checklist: ${have} of the ${need.length} required parts are here`
  redraw('checklist')
}

// ---- template ----
// Switching (R21 to R03, a report to a grant) merges the new template in.
async function renderTemplate(body) {
  const t = await api(P('/template'))
  if (mode !== 'template') return
  const pick = (id, opts, v, none) => `<select id="${id}">${none ? `<option value="">${none}</option>` : ''}` +
    opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>'
  const now = !t.template ? 'has no template' : `${t.recorded ? 'uses' : 'looks like it came from'} ` +
    `<b>${esc(t.template)}</b>${t.brand ? ` with <b>${esc(t.brand)}</b> branding` : ''}`
  body.innerHTML = `<p class="hint">This project ${now}. Switching merges the new template into it: what the
    template changes lands, what you wrote stays; where both changed a file, yours stays and the template's
    is put beside it.</p><div class="cite-bar">${pick('tpl-to', t.templates, t.template)}
    ${pick('tpl-brand', t.brands, t.brand, 'no branding')}<button id="tpl-go">switch</button></div>
    <div id="tpl-out"></div>`
  $('tpl-go').onclick = async e => {
    const to = $('tpl-to').value, brand = $('tpl-brand').value || null
    if (!confirm(`Switch this project to ${to}${brand ? ' + ' + brand : ''}? It is committed as a checkpoint, ` +
      'so it can be undone from History.')) return
    e.target.disabled = true
    const r = await post(P('/template'), { template: to, brand })
    if (r.error) { e.target.disabled = false; return alert(r.error) }
    const list = (title, xs) => !xs.length ? '' : `<p><b>${title}</b> ` + xs.map(x => Array.isArray(x)
      ? `${esc(x[0])} (the template's: ${esc(x[1])})` : esc(x)).join(', ') + '</p>'
    $('tpl-out').innerHTML = list('Added:', r.added) + list('Updated (you had not changed them):', r.updated) +
      list('Merged with your changes:', r.merged) +
      list('Where you and the template both changed the same lines, yours was kept:',
        r.kept.map(([f, n]) => `${f} (${n} place${n > 1 ? 's' : ''}; check it)`)) +
      list('Kept yours, the template\'s beside it:', r.beside) +
      list('Removed (old template files you had not changed):', r.removed) +
      (r.beside.length ? `<p class="hint">To move your writing into the new structure, ask an agent member in
        the Discussion, e.g. "@claude move the text of ${esc(r.beside[0][0])} into the sections of
        ${esc(r.beside[0][1])}".</p>` : '')
    refreshDisk()
  }
}

// ---- while you were away ----
// Back online after others edited, each file they changed, to keep or revert.
// (The CRDT has merged it all already: this is awareness, and one-click undo.)
let away = false, review = null
const snapshot = () => Object.fromEntries([...files].map(([p, t]) => [p, t.toString()]))
const toReview = before => setTimeout(() => { // once the remote updates have settled
  const now = snapshot(), changed = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .map(p => ({ path: p, before: before[p] ?? '', after: now[p] ?? '' })).filter(c => c.before !== c.after)
  if (!changed.length) return
  review = changed; $('status').dataset.review = '1'
  openSidebar('review')
}, 1200)
local.whenSynced.then(() => provider.on('status', ({ status }) => {
  if (status === 'disconnected') away = true
  // 'connected' comes before the sync applies: this is my offline version, my edits in it
  if (status !== 'connected' || !away) return
  away = false; toReview(snapshot())
}))
// an offline copy the hub refused (doc.js): its text against the hub's
const kept = sessionStorage[AWAY] && JSON.parse(sessionStorage[AWAY])
if (kept) provider.on('synced', function was() { provider.off('synced', was); delete sessionStorage[AWAY]; toReview(kept) })
// side by side: [mine, now, changed, line numbers]; a blank side is a gap
const rows = (a, b) => {
  const A = a.split('\n'), B = b.split('\n'), r = [], n = [0, 0] // past 1000 edits, as a whole
  const cs = diffArrays(A, B, { maxEditLength: 1000 }) ?? [{ removed: true, value: A }, { added: true, value: B }]
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    if (!c.added && !c.removed) { c.value.forEach(l => r.push([l, l, 0, ++n[0], ++n[1]])); continue }
    const o = c.removed ? c.value : [], m = c.added ? c.value : cs[i + 1]?.added ? cs[++i].value : []
    for (let j = 0; j < Math.max(o.length, m.length); j++)
      r.push([o[j], m[j], 1, o[j] != null && ++n[0], m[j] != null && ++n[1]])
  }
  return r
}
const row = ([o, n, ch, i, j]) => { // the words that changed, marked within the line
  const w = ch && o != null && n != null ? diffWordsWithSpace(o, n) : [{ value: o ?? n }]
  const half = (t, k, skip, mark, tag) => t == null ? '<div class="dl gap"></div>' :
    `<div class="dl ${ch ? tag : 'same'}" data-n="${k}">${w.filter(p => !p[skip]).map(p =>
      p[mark] ? `<${tag}>${esc(p.value)}</${tag}>` : esc(p.value)).join('') || '&nbsp;'}</div>`
  return half(o, i, 'added', 'removed', 'del') + half(n, j, 'removed', 'added', 'ins')
}
// the changes, k lines around each (all of it without k)
const sbs = (r, k) => { let last = -1
  return '<div class="sbs"><div class="dh">yours, offline</div><div class="dh">now</div>' + r.map((x, i) => {
    if (k != null && !r.slice(Math.max(0, i - k), i + k + 1).some(y => y[2])) return ''
    const s = i > last + 1 ? '<div class="dsep">\u22EF</div>' : ''; last = i
    return s + row(x)
  }).join('') + '</div>' }
function renderReview(body) {
  if (!review?.length) return body.innerHTML = '<p class="empty">No changes to review. This appears after ' +
    'reconnecting if others edited while you were offline.</p>'
  const done = p => { review = review.filter(r => r.path !== p)
    if (!review.length) $('status').dataset.review = ''
    renderReview(body) }
  body.replaceChildren(el('p', { className: 'review-head', textContent: 'While you were away, ' +
    `${review.length} file(s) changed. Keep what others did, or revert to your offline version.` }),
  ...review.map(({ path: p, before, after }) => { let r
    const e = el('div', { className: 'review-file', innerHTML: `<div class="review-file-head"><b>${esc(p)}</b>` +
      '<span><button>keep theirs</button><button class="revert">revert to mine</button></span></div>' +
      `<div class="review-diff">${sbs(r = rows(before, after), 2)}</div>` +
      `<details><summary>whole file</summary><div class="review-diff">${sbs(r)}</div></details>` })
    const [keep, revert] = e.querySelectorAll('button')
    keep.onclick = () => { if (files.has(p)) openFile(p); done(p) }
    revert.onclick = () => {
      const t = files.get(p)
      t ? setText(t, before) : before && files.set(p, new Y.Text(before))
      done(p)
    }
    return e
  }), el('button', { className: 'go', textContent: 'keep all', onclick: () => {
    review = null; $('status').dataset.review = ''; openSidebar('comments')
  } }))
}
