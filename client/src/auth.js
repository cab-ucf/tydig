// Accounts: better-auth's client, the sign-in screen that holds the app back
// until there is a session (a cookie, so fetch and websockets carry it), and
// the account's own actions.
import { link, plain } from './link.js'
import { createAuthClient } from 'better-auth/client'
import { organizationClient, genericOAuthClient } from 'better-auth/client/plugins'

// the hub's name, from its brand.css
document.title = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim().slice(1, -1)

export const authClient = createAuthClient({
  baseURL: location.origin,
  plugins: [organizationClient(), genericOAuthClient()],
})

export async function requireUser() {
  for (;;) {
    const { data } = await authClient.getSession()
    if (data?.user) return join ? joined(data.user) : data.user
    await loginScreen()
  }
}

export const signOut = async () => { await authClient.signOut(); location.search = '' }
export async function changePassword() {
  const currentPassword = prompt('Current password:')
  const newPassword = currentPassword && prompt('New password (8+ characters):')
  if (!newPassword) return
  const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
  alert(error ? error.message : 'Password changed; other sessions are signed out.')
}
export async function deleteAccount() {
  if (!confirm('Delete your account? Projects you own pass to an admin, else to the longest-standing member; ' +
    'a project nobody else is in is deleted with it. This cannot be undone.')) return
  const password = prompt('Your password, to confirm:')
  if (!password) return
  const { error } = await authClient.deleteUser({ password })
  error ? alert(error.message) : location.reload()
}

// The failures people hit, said as what to do. By code: a wrong password
// reads "Invalid email or password", which is not a malformed address.
function explain(error, email) {
  const msg = error.message || 'Sign-in failed.'
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD')
    return 'Wrong email or password. No account with this address yet? Use Create account.'
  if (['INVALID_EMAIL', 'VALIDATION_ERROR'].includes(error.code) && /email/i.test(msg))
    return `"${email}" isn't a valid address. It needs a dot and a suffix -- bare hosts like name@localhost ` +
      'are rejected. Try you@example.com; nothing is ever sent to it.'
  if (error.code === 'INVALID_ORIGIN' || /invalid origin/i.test(msg))
    return `The server does not trust this address (${location.origin}). Open the app at the URL the server ` +
      `was configured with, or set TYDIG_URL and TYDIG_ORIGINS to ${location.origin} and restart.`
  return msg
}

// An invite link (?invite=<id>) opens on Create account and carries its key;
// a join link (?join=<code>) carries a code, which works signed in or not.
const q = new URLSearchParams(location.search), invite = q.get('invite')
let join = q.get('join')
async function joined(user) {
  const r = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: join }) }).then(r => r.json(), () => ({ error: 'the hub did not answer' }))
  if (r.error) { alert(r.error); history.replaceState(null, '', location.pathname); return user }
  location.replace(`${location.pathname}?proj=${encodeURIComponent(r.project)}${location.hash}`)
  return new Promise(() => {})
}
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
const DOCS = 'docs/'
// the static site: open any hub by its link or code
const hubBox = `<form class="auth-hub"><input name="hub" required
  placeholder="a hub's link or code"><button class="go">open</button></form>`
const foot = `<p class="auth-foot"><a href="${DOCS}" target="_blank" rel="noopener">What is tydig?</a></p>`
const wire = root => {
  const f = root.querySelector('.auth-hub')
  if (f) f.onsubmit = e => {
    e.preventDefault()
    const v = f.hub.value.trim()
    location.hash = v.includes('#') ? v.slice(v.indexOf('#')) : '#' + v
    location.reload()
  }
}

async function loginScreen() {
  const cfg = await fetch('/api/auth-config').then(r => r.json()).catch(() => null)
  if (!cfg) { // the static site with no hub, or one that did not answer (link.js says why)
    const root = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'auth-gate' }))
    root.innerHTML = `<div class="auth-card"><div class="auth-brand"></div>
      <p><b>Ty</b>pst, <b>d</b>ecentralized collaboration with <b>i</b>roh, saved in <b>g</b>it:
      papers written together in the browser, computed by a hub you run.</p>
      ${plain ? `<p>The hub is not answering: it may be off or restarting. Try again in a minute.</p>
      <button class="go" onclick="location.reload()">try again</button>` : `
      <p>${link ? 'That hub did not answer. Another one:' : "Open a hub with the link its owner sent you:"}</p>
      ${hubBox}`}<p class="auth-foot"><a href="${DOCS}" target="_blank" rel="noopener">Docs</a> ·
      <a href="https://github.com/cab-ucf/tydig" target="_blank" rel="noopener">run your own hub</a></p></div>`
    wire(root)
    return new Promise(() => {})
  }
  // SSO returns to the hub's own address, which a link visitor cannot hold a session for
  if (link) delete cfg.sso
  const root = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'auth-gate' }))
  // an origin the server does not trust can never sign in: say so first
  root.innerHTML = `<div class="auth-card"><div class="auth-brand"></div>
    ${cfg.originOk === false ? `<p class="auth-warn">This server does not trust <b>${location.origin}</b>.<br>
      Open the app at the address it was set up with, or set
      <code>TYDIG_URL</code> and <code>TYDIG_ORIGINS</code> to <b>${location.origin}</b> and restart
      (<code>just up</code>).</p>` : ''}
    ${cfg.sso ? `<button type="button" class="go auth-sso">Sign in with ${esc(cfg.sso.label)}</button>
      ${cfg.sso.only ? '' : '<div class="auth-or">or use email</div>'}` : ''}
    <div class="auth-tabs">
      <button data-tab="in" class="on">Sign in</button><button data-tab="up">Create account</button></div>
    <form id="auth-form">
      <label class="up-only" hidden>Name (shown on your comments)<input name="name" autocomplete="name"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required
        placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required
        minlength="8"></label>
      <label>Code, if you were given one<input name="code"
        autocomplete="off" placeholder="tidy ruby otter" value="${esc(join || '')}"></label>
      <p class="auth-err" hidden></p>
      <button type="submit" class="go auth-submit">Sign in</button>
    </form>${link && !plain ? `<div class="auth-or">or another hub</div>${hubBox}` : ''}${foot}</div>`
  wire(root)
  const form = root.querySelector('#auth-form'), err = root.querySelector('.auth-err')
  const submit = root.querySelector('.auth-submit'), tabs = root.querySelectorAll('.auth-tabs button')
  if (cfg.sso) {
    root.querySelector('.auth-sso').onclick = () =>
      authClient.signIn.oauth2({ providerId: cfg.sso.providerId, callbackURL: location.href })
    if (cfg.sso.only) form.hidden = root.querySelector('.auth-tabs').hidden = true
  }
  let up = false
  tabs.forEach(b => b.onclick = () => {
    up = b.dataset.tab === 'up'
    tabs.forEach(x => x.classList.toggle('on', x === b))
    root.querySelectorAll('.up-only').forEach(l => l.hidden = !up)
    form.name.required = up // shown on comments, so never made from the address
    submit.textContent = up ? 'Create account' : 'Sign in'
    form.password.autocomplete = up ? 'new-password' : 'current-password'
    err.hidden = true
  })
  if (invite || join) tabs[1].click()
  return new Promise(resolve => form.onsubmit = async e => {
    e.preventDefault()
    err.hidden = true; submit.disabled = true
    const body = { email: form.email.value, password: form.password.value }
    const res = !up ? await authClient.signIn.email(body) : await authClient.signUp.email({ ...body,
      name: form.name.value.trim(), fetchOptions: { headers: { ...invite && { 'x-tydig-invite': invite },
        ...form.code.value.trim() && { 'x-tydig-join': form.code.value.trim() } } } })
    submit.disabled = false
    if (res.error) { err.textContent = explain(res.error, form.email.value); err.hidden = false; return }
    if (invite) history.replaceState(null, '', location.href.replace(/[?&]invite=[^&#]*/, ''))
    if (form.code.value.trim()) join = form.code.value.trim()
    root.remove(); resolve()
  })
}
