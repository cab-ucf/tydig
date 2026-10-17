// The side panel, and its panes but comments and the Discussion (comments.js),
// citations (cite.js) and spelling (spell.js): history and checkpoints, builds (and watch), the
// grant checklist, the template switch, and changes made while you were away.
import * as Y from 'yjs'
import { diffArrays } from 'diff'
import { renderCite, citeAt, bibOf } from './cite.js'
import { parseBib } from '../../server/refs.mjs'
import { prose, readAi, aiPct } from './surprise.js'
import { renderSpelling } from './spell.js'
import { $, el, esc, api, post, toast, settings, phone, me, projName, P, rawUrl, choose, icon, assist } from './util.js'
import { files, provider, local, okPath, GEN, setText } from './doc.js'
import { view, path, open, openFile, reveal } from './editor.js'
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
// the panes always at hand, each with what is new in it; any other, a tab while open
const TABS = { comments: 'Comments', chat: 'Discussion', history: 'History', build: 'Build' }
export function tabs() {
  const n = unseen(), extra = mode && !TABS[mode] ? { [mode]: { aicheck: 'AI check' }[mode] ?? mode[0].toUpperCase() + mode.slice(1) } : {}
  $('side-tabs').replaceChildren(...Object.entries({ ...TABS, ...extra }).map(([m, t]) => el('button',
    { className: m === mode ? 'on' : '', onclick: () => openSidebar(m) }, t,
    n[m] ? el('b', { className: 'badge', textContent: n[m] }) : '')))
  $('side-tabs').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// the pane again, if it is the one open
export function redraw(m) { if (mode === m) panes()[m]($('side-body')) }
export function toggleSide() {
  if (!settings.sideOpen) return openSidebar(mode || 'comments')
  settings.sideOpen = false; applyLayout()
}
$('side-close').onclick = () => { settings.sideOpen = false; mode = null; applyLayout() }

// ---- AI check ----
// Every file's prose, read by MELD: each file's AI-likeness, how many
// sentences fall in each band, and the most AI-like, each a click away.
// What a reviewer might flag, before they do.
let aiReport = null
const BANDS = [[0.7, 'blocked out (70% and up)'], [0.4, 'strong (40 to 70%)'], [0.08, 'tinted (8 to 40%)'], [0, 'typical']]
const chip = p => el('span', { className: `ai-chip${p >= 0.7 ? ' ai-top' : p >= 0.4 ? ' ai-mid' : ''}`,
  style: `--ai:${Math.min(1, 0.22 + 0.85 * p).toFixed(2)}`, textContent: `${Math.round(100 * p)}%` })
async function renderAiCheck(body) {
  const engine = settings.scope?.url ? { url: settings.scope.url } : (await assist).surprise ? { hub: `/api${P('/surprise')}` } : null
  if (!engine) return body.replaceChildren(el('p', { className: 'empty', textContent: 'No AI detector here: ' +
    'Settings › Surprise overlay, with a Perplexiscope engine on this machine, or a hub that runs one.' }))
  const status = el('p', { className: 'hint' })
  const go = el('button', { className: 'go', textContent: aiReport ? 'Check again' : 'Check every file', onclick: async () => {
    go.disabled = true; const out = []
    const typs = [...files].filter(([p]) => p.endsWith('.typ') && !/^lib\/|^(checklist|budget|budget-report)\.typ$/.test(p))
    for (const [i, [file, t]] of typs.entries()) {
      const src = t.toString(), pr = prose(src)
      if ((pr.text.match(/\p{L}+/gu) || []).length < 40) continue
      status.textContent = `reading ${i + 1} of ${typs.length}: ${file}…`
      try {
        const a = await readAi(engine, pr.text)
        if (a) out.push({ file, a, sents: a.sents.filter(x => x.s != null).map(x => {
          const from = pr.at[x.s], to = pr.at[x.e - 1] + 1
          return { file, from, to, p: aiPct(x.tail), text: src.slice(from, to).replace(/\s+/g, ' ').trim() }
        }) })
      } catch (e) { out.push({ file, error: e.message }) }
    }
    aiReport = out; redraw('aicheck')
  } })
  const r = aiReport, all = (r || []).flatMap(f => f.sents || [])
  body.replaceChildren(el('p', { className: 'hint', textContent: 'How AI-like each sentence reads to MELD, ' +
    'measured against human writing: what a reviewer might flag. The overlay (Settings) shows it as you write.' }),
  go, status, ...!r ? [] : [
    el('div', { className: 'ai-bands' }, ...BANDS.map(([lo, name], i) => {
      const n = all.filter(s => s.p >= lo && (i === 0 || s.p < BANDS[i - 1][0])).length
      return el('div', {}, lo ? chip(lo + 0.01) : el('span', { className: 'ai-chip', textContent: '·' }), ` ${n} ${name}`)
    })),
    ...r.map(f => el('p', { className: 'cfile', textContent: f.error ? `${f.file}: ${f.error}`
      : `${f.file}: ${f.a.words < 100 ? 'too short to judge as a whole' : `AI-likeness ${Math.round(100 * aiPct(f.a.tail))}% as a whole`}` })),
    ...all.filter(s => s.p >= 0.08).sort((a, b) => b.p - a.p).slice(0, 30).map(s =>
      el('div', { className: 'ai-row', onclick: () => reveal(s.file, s.from, s.to) }, chip(s.p),
        el('span', {}, s.text.length > 180 ? s.text.slice(0, 180) + '…' : s.text, el('small', { textContent: s.file })))),
    all.length && !all.some(s => s.p >= 0.08) ? el('p', { className: 'empty', textContent: 'Every sentence reads as typical of human writing.' }) : '',
  ])
}

// Cite: papers for the selection, alone or steered by the file's topic; the
// citation goes after it
export function cite(alone) {
  const s = view?.state.selection.main, sel = s && !s.empty && view.state.sliceDoc(s.from, s.to)
  const typ = path?.endsWith('.typ'), text = t => typ ? prose(t).text : t
  citeCtx = { files, view: () => view, current: () => path, at: sel ? s.to : undefined,
    query: sel ? text(sel) : '', context: sel && !alone ? text(view.state.doc.toString()) : '' }
  openSidebar('cite')
}
// a reference already in the bibliography, found by any of its words
export function citeFromBib() {
  const s = view?.state.selection.main, entries = parseBib(files.get(bibOf(files))?.toString() || '')
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
const badge = v => !v ? '' : v.verified ? '<span class="prov ok" title="ML-DSA-65 signature by a key ' +
  `registered to this account; file hashes match (key ${esc(v.keyId)})">signed &#10003;</span>`
  : '<span class="prov warn" title="signature present but not verifiable">unverified</span>'
const commit = c => `<div class="commit${c.message.startsWith('checkpoint') ? ' checkpoint' : ''}">` +
  `<code>${esc(c.hash)}</code><span>${esc(c.message)}</span>${badge(c.provenance)}` +
  `<time>${new Date(c.date).toLocaleString()}</time><button data-hash="${esc(c.hash)}">restore</button></div>`
async function renderHistory(body) {
  const log = await api(P('/history'))
  if (mode !== 'history') return // another pane was opened meanwhile
  body.innerHTML = log.map(commit).join('') ||
    '<p class="empty">No commits yet. Edits autosave every few seconds.</p>'
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
const uploadPdf = file => el('input', { type: 'file', accept: '.pdf,application/pdf', onchange: async e => {
  const r = await fetch(rawUrl(file.replace('*', 'upload')), { method: 'PUT', body: e.target.files[0] })
  r.ok ? refreshDisk() : alert(`upload failed: ${(await r.json().catch(() => ({}))).error || r.status}`)
} }).click()
const item = i => {
  const built = i.file?.startsWith('out/'), ok = i.have?.length, need = i.when === 'always'
  const acts = ok ? [el('button', { textContent: 'open', onclick: () => open(i.have[0]) })]
    : !i.file || built ? [] : [/^https?:/.test(i.from || '')
      ? el('a', { href: i.from, target: '_blank', rel: 'noopener', textContent: 'get it' }) : '',
    el('button', { textContent: 'upload', onclick: () => uploadPdf(i.file) })]
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
// the bar's count: required components that are here, of all required
export function checklistBadge() {
  const items = checklist(), b = $('bar-check')
  if (b.hidden = !items) return
  const need = items.filter(i => i.when === 'always' && i.file)
  b.textContent = `checklist ${need.filter(i => i.have?.length).length}/${need.length}`
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
local.whenSynced.then(() => provider.on('status', ({ status }) => {
  if (status === 'disconnected') away = true
  // 'connected' comes before the sync applies: this is my offline version, my edits in it
  if (status !== 'connected' || !away) return
  const before = snapshot()
  away = false
  setTimeout(() => { // once the remote updates have settled
    const now = snapshot(), changed = [...new Set([...Object.keys(before), ...Object.keys(now)])]
      .map(p => ({ path: p, before: before[p] ?? '', after: now[p] ?? '' })).filter(c => c.before !== c.after)
    if (!changed.length) return
    review = changed; $('status').dataset.review = '1'
    openSidebar('review')
  }, 1200)
}))
const lines = (a, b) => {
  const A = a.split('\n'), B = b.split('\n') // past 1000 edits, as a whole
  return (diffArrays(A, B, { maxEditLength: 1000 }) ?? [{ removed: true, value: A }, { added: true, value: B }])
    .flatMap(c => c.value.map(l => `<div class="dl ${c.added ? 'add' : c.removed ? 'del' : 'same'}">` +
      `${c.added ? '+' : c.removed ? '-' : '&nbsp;'} ${esc(l) || '&nbsp;'}</div>`)).join('')
}
function renderReview(body) {
  if (!review?.length) return body.innerHTML = '<p class="empty">No changes to review. This appears after ' +
    'reconnecting if others edited while you were offline.</p>'
  const done = p => { review = review.filter(r => r.path !== p); renderReview(body) }
  body.replaceChildren(el('p', { className: 'review-head', textContent: 'While you were away, ' +
    `${review.length} file(s) changed. Keep what others did, or revert to your offline version.` }),
  ...review.map(({ path: p, before, after }) => {
    const e = el('div', { className: 'review-file', innerHTML: `<div class="review-file-head"><b>${esc(p)}</b>` +
      '<span><button>keep theirs</button><button class="revert">revert to mine</button></span></div>' +
      `<div class="review-diff">${lines(before, after)}</div>` })
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
