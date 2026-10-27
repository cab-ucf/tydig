// Dialogs: projects (pick, create, import), sharing (members, invites,
// agents, irch) and the git remote.
import { authClient } from './auth.js'
import { plain } from './link.js'
import { $, api, post, del, esc, el, toast, projName, P, choose, me } from './util.js'

const go = n => location.search = `?proj=${n}`
const modal = id => $(id).open || $(id).showModal()
export const ARCHIVE = /\.(zip|tgz|tar\.gz|tar)$/i

// An archive, unpacked by the hub into project n: what changed, said.
export async function unpackInto(n, f, dir = '') {
  const q = `name=${encodeURIComponent(f.name)}&dir=${encodeURIComponent(dir)}`
  const r = await api(`/p/${n}/import?${q}`, { method: 'POST', body: f,
    headers: { 'content-type': 'application/octet-stream' } }).catch(e => ({ error: e.message }))
  if (r.error) return alert(`${f.name}: ${r.error}`), r
  const list = (t, xs) => !xs.length ? '' : `<br>${t}: ${xs.slice(0, 8).map(esc).join(', ')}` +
    (xs.length > 8 ? ` and ${xs.length - 8} more` : '')
  toast(`${esc(f.name)}: ${r.added.length} added, ${r.changed.length} updated, ${r.same} unchanged` +
    list('updated', r.changed) + list('skipped (bad names)', r.skipped), true, 8000)
  return r
}

export async function renderProjects() {
  $('projects-list').replaceChildren(...(await api('/projects')).filter(p => !p.archived || p.name === projName)
    .map(({ name: n, archived: a }) => el('a', { href: `?proj=${n}${location.hash}`,
      className: 'pnode' + (n === projName ? ' active' : '') + (a ? ' archived' : ''), textContent: n })))
}

// archived: done, out of the side list and locked in the picker; a click unlocks it
export async function archive(n = projName) {
  const a = (await api('/projects')).find(p => p.name === n)?.archived
  await api(`/p/${n}/archived`, { method: a ? 'DELETE' : 'PUT' })
  renderProjects(); $('picker').open && openPicker()
}

export async function deleteProject() {
  if (prompt(`Delete ${projName} for everyone: its files, history and members? This cannot be undone ` +
    '(a git remote is untouched). Type its name to confirm:') !== projName) return
  const r = await del(P(''))
  r.error ? alert(r.error) : location.search = ''
}

export async function openPicker() {
  const [list, { templates, brands, featured }] = await Promise.all([api('/projects'), api('/templates')])
  $('proj-list').replaceChildren(...list.sort((x, y) => x.archived - y.archived).map(({ name: n, role, archived: a }) =>
    el('div', { className: a ? 'archived' : '' }, el('a', { href: `?proj=${n}${location.hash}`,
      className: n === projName ? 'current' : '', textContent: role === 'owner' ? `${n} (owner)` : n }),
    el('button', { textContent: a ? '\u{1F512}' : '\u{1F513}', title: a ? 'archived: unlock' : 'archive: done',
      onclick: () => archive(n) }))))
  // tydig's own, then Typst Universe's (server/packages.mjs): the featured, or any, searched for
  const group = (label, opts) => el('optgroup', { label }, ...opts)
  const universe = (kind, label) => group(label, featured.filter(f => f.kind === kind).map(f => new Option(f.label, f.spec)))
  $('proj-tpl').replaceChildren(group('Grants and reports', templates.map(t => new Option(t))),
    universe('journal', 'Journals and conferences (Typst Universe)'), universe('poster', 'Posters (Typst Universe)'),
    new Option('Search every Typst Universe template…', 'search'))
  $('proj-tpl').onchange = async ({ target: s }) => {
    if (s.value !== 'search') return
    s.value = templates[0]
    const all = await api('/universe')
    if (all.error) return alert(all.error)
    choose(q => all.filter(t => q.toLowerCase().split(/\s+/).every(w =>
      `${t.spec} ${t.description} ${t.categories}`.toLowerCase().includes(w))).map(t => ({
      label: `${t.spec.slice(9)}: ${t.description}`, hint: t.categories.join(' '),
      run: () => { s.append(new Option(t.spec.slice(9), t.spec)); s.value = t.spec } })),
    'search Typst Universe: journal, poster, thesis, IEEE…')
  }
  $('proj-brand').replaceChildren(new Option('no branding', ''), ...brands.map(b => new Option(b)))
  $('proj-new').onsubmit = async () => {
    const n = $('proj-name').value
    const r = await post(`/projects/${n}`, { template: $('proj-tpl').value, brand: $('proj-brand').value })
    r.error ? alert(r.error) : go(n)
  }
  $('proj-zip').onclick = () => $('proj-zip-input').click()
  $('proj-zip-input').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    const n = $('proj-name').value || f.name.replace(ARCHIVE, '').replace(/[^\w-]/g, '-').slice(0, 64)
    const r = await post(`/projects/${n}`, { empty: true })
    if (r.error) return alert(r.error)
    if (!(await unpackInto(n, f)).error) go(n)
  }
  $('proj-git').onsubmit = async () => {
    const url = $('proj-git-url').value.trim()
    const n = url && prompt('Open as project name:',
      url.replace(/\.git$/, '').split('/').pop().replace(/[^\w-]/g, '').slice(0, 64))
    if (!n) return
    const r = await post(`/projects/${n}`, { gitUrl: url }), page = keysPage(url)
    if (r.error && r.key) return prompt(`${r.error}\n\nIf the repo is private, add this deploy key to it ` +
      `(repo settings > deploy keys${page ? `: ${page}` : ''}), then open it again:`, r.key)
    r.error ? alert(r.error) : go(n)
  }
  modal('picker')
}

export async function showShare() {
  const body = $('share-body')
  body.innerHTML = '<p class="empty">loading...</p>'
  modal('share')
  const org = authClient.organization.getFullOrganization({ query: { organizationSlug: projName } })
  const [share, orgs, full, agents, codes, irch] = await Promise.all([api('/link'), api('/projects'),
    org.then(r => r.data, () => null), api(P('/agents')).catch(() => []), api(P('/join')).catch(() => []),
    api(P('/irch')).catch(() => ({}))])
  const owner = ['owner', 'admin'].includes(orgs.find(o => o.name === projName)?.role)
  // the hub's address: this page on the site's own hub (cxn.pub), else its link
  const site = plain || !share.link ? location.origin + location.pathname : share.link
  const siteWith = q => Object.assign(new URL(site), { search: q }).href
  const row = (who, role, act, id, label = act, may = owner && role !== 'owner') =>
    `<div class="share-row"><span>${esc(who)}</span><em>${esc(role)}</em>${may ? `<button data-${act}="${esc(id)}">${label}</button>` : ''}` +
    '</div>'
  const member = m => row(m.user?.email || m.user?.name || m.userId, m.role,
    ...m.userId === me.id ? ['leave', m.id, 'leave', m.role !== 'owner'] : ['remove', m.id])
  const invited = i => row(i.email, 'invited', 'cancel', i.id) + (!owner ? '' : '<div class="share-row">' +
    `<input readonly value="${esc(siteWith('invite=' + i.id))}" title="their invite link"></div>`)
  const code = c => row(c.code.replaceAll('-', ' '), `until ${new Date(c.expires).toLocaleDateString()}`,
    'uncode', c.code, 'stop') + `<div class="share-row"><input readonly value="${esc(siteWith('join=' + c.code))}"></div>`
  body.innerHTML = `<div class="share-list">${(full?.members || []).map(member).join('')}
      ${(full?.invitations || []).filter(i => i.status === 'pending').map(invited).join('')}</div>
    ${owner ? `<div class="share-list">${(Array.isArray(codes) ? codes : []).map(code).join('')}</div>
      <button id="code-add" class="go">new code</button>
      <p class="hint">A code lets anyone make an account and join this project for a week: send its link,
        or just say "${esc(new URL(site).host)}, code ${(codes[0]?.code || 'tidy-ruby-otter').replaceAll('-', ' ')}".
        Stop it once everyone is in; members stay.</p>
      <form id="share-add" class="row">
      <input type="email" id="share-email" placeholder="collaborator@email" required><button class="go">add</button></form>
      <p class="hint">An address is invited unless its account here is verified: send them its invite link
        (below it), which signs them up, or in, with the project waiting. The address alone gets nothing.</p>`
      : '<p class="hint">Only the owner can add collaborators.</p>'}
    ${share.link ? `<p class="hint">They open this in any browser, nothing to install:</p>
      <input readonly value="${esc(site)}">` : ''}
    <h4>Agents</h4>
    <div class="share-list">${agents.map(a => row('@' + a.name, 'agent', 'agent', a.name, 'remove')).join('')}</div>
    ${owner ? `<form id="agent-add" class="row">
      <input id="agent-name" placeholder="agent name, e.g. claude" required><button class="go">add</button></form>
      <p class="hint">An agent works on this project only: reads and edits its text, and answers where it is
        @mentioned, in comments and the Discussion. Run it where Claude Code is installed.</p>` : ''}
    ${irch.on ? `<h4>irch</h4>${irch.where ? `<div class="share-list">${row(irch.where, 'mirrors the Discussion',
      'unirch', 1, 'stop', owner)}</div>` : owner ? `<form id="irch-add" class="row">
      <input id="irch-code" placeholder="an irch invite code" required><button class="go">link</button></form>
      <p class="hint">The Discussion and a channel of an irch space then carry each other's messages, so
        they reach everyone's phone. In irch: the space's <i>Invite</i>. The channel is #${esc(projName)},
        made if this hub may, else the space's first.</p>` : ''}` : ''}`
  const on = (act, f) => { for (const b of body.querySelectorAll(`[data-${act}]`)) b.onclick = () => f(b.dataset[act]) }
  const then = r => r?.error ? alert(r.error) : showShare()
  on('remove', async id => confirm('Remove this collaborator? They lose access at once.') &&
    then(await del(P('/members/' + id))))
  on('leave', async id => confirm(`Leave ${projName}? A member must add you again.`) &&
    (r => r.error ? alert(r.error) : location.search = '')(await del(P('/members/' + id))))
  on('cancel', id => authClient.organization.cancelInvitation({ invitationId: id }).then(showShare))
  on('uncode', async c => then(await del(P('/join/' + c))))
  on('agent', async a => confirm(`Remove @${a}? Its token stops working at once.`) &&
    then(await del(P('/agents/' + a))))
  on('unirch', async () => then(await del(P('/irch'))))
  if (!owner) return
  if ($('irch-add')) $('irch-add').onsubmit = async e => {
    e.preventDefault(); then(await post(P('/irch'), { code: $('irch-code').value }))
  }
  $('code-add').onclick = async () => then(await post(P('/join')))
  $('share-add').onsubmit = async e => {
    e.preventDefault(); then(await post(P('/members'), { email: $('share-email').value }))
  }
  $('agent-add').onsubmit = async e => {
    e.preventDefault()
    const r = await post(P('/agents'), { name: $('agent-name').value })
    if (r.error) return alert(r.error)
    prompt(`@${r.name} is a member. Its token is shown only now. On the hub's machine, run:`,
      `TYDIG_AGENT_TOKEN=${r.token} just agent ${projName}`)
    showShare()
  }
}

// Where a repo takes deploy keys, from its SSH URL (GitHub, GitLab, Gitea/Forgejo).
const keysPage = url => {
  const m = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(url || '')
  return m && `https://${m[1]}/${m[2]}/` + (/gitlab/.test(m[1]) ? '-/settings/repository'
    : /github/.test(m[1]) ? 'settings/keys/new' : 'settings/keys')
}

// The project's durable home on any git host. The hub pushes when it goes
// idle and when it shuts down, so no machine here has to stay up.
export async function showGitRemote() {
  const body = $('git-body')
  body.innerHTML = '<p class="empty">loading...</p>'
  modal('git')
  const st = await api(P('/gitremote')), page = keysPage(st.url)
  body.innerHTML = `
    <p class="hint">A repository on any git host (GitHub, GitLab, Codeberg, a bare repo on a NAS) gets the
      working tree in readable form, so the paper is browsable and clonable there, and this hub's CRDT
      state under <code>.collab/crdt/</code>. Each hub writes only its own state file, so several can
      share one remote. Signatures and comments travel as git notes; <code>out/</code> is never pushed.</p>
    <label>Repository URL<div class="row"><input id="git-url" placeholder="https://github.com/lab/paper.git"
      value="${st.configured ? esc(st.url) : ''}">
      <input id="git-branch" placeholder="main" value="${esc(st.branch || 'main')}"></div></label>
    <p class="hint">Private repo: give its SSH URL (<code>git@github.com:lab/paper.git</code>) and add this
      project's key to it as a deploy key with write access; Ctrl-S then commits and pushes.</p>
    ${st.key ? `<div class="git-key"><b>This project's deploy key</b>
      <textarea readonly rows="2">${esc(st.key)}</textarea>
      ${page ? `<a href="${esc(page)}" target="_blank" rel="noopener">add it to the repo &rarr;</a>`
        : 'Add it to the repo as a deploy key'} (paste, tick <i>write access</i>), then push.</div>` : ''}
    <div class="row"><button id="git-save">${st.configured ? 'update' : 'set remote'}</button>
      ${!st.configured ? '' : '<button id="git-sync">push now</button>' +
        '<button id="git-clear" class="danger">forget remote</button>'}</div>
    <p class="hint">this hub: <code>${esc(st.hubId || '')}</code><br>
      last sync: ${st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never'}</p>
    ${st.lastError ? `<p class="err">${esc(st.lastError)}</p>` : ''}`
  $('git-save').onclick = async () => {
    const url = $('git-url').value.trim(), branch = $('git-branch').value.trim() || 'main'
    const r = await post(P('/gitremote'), { url, branch })
    r.error ? alert(r.error) : showGitRemote()
  }
  if (!st.configured) return
  $('git-sync').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'pushing...'
    const r = await post(P('/gitremote/sync'))
    if (r.error || r.ok === false)
      alert(r.error || r.lastError || 'push failed - check credentials and branch protection')
    showGitRemote()
  }
  $('git-clear').onclick = async () => confirm('Forget this remote? The project stays on this hub; ' +
    'the repository is untouched.') && (await del(P('/gitremote')), showGitRemote())
}
