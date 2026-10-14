// Accounts: better-auth's client, the sign-in screen that holds the app back
// until there is a session (a cookie, so fetch and websockets carry it), and
// the account's own actions.
import { link } from './link.js'
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
    if (data?.user) return data.user
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

// An invite link (?invite=<id>) opens on Create account and carries its key.
const invite = new URLSearchParams(location.search).get('invite')
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

async function loginScreen() {
  const cfg = await fetch('/api/auth-config').then(r => r.json()).catch(() => null)
  if (!cfg) { // the static site with no hub in its address (in link mode, link.js says why)
    if (!link) document.body.insertAdjacentHTML('beforeend', `<div id="auth-gate"><div class="auth-card">
      <div class="auth-brand"></div><p>This page needs a hub's link: the full address ending in
      <code>#</code> and a code, which the hub prints (<code>just link</code>) and shows under Settings &gt;
      Share. Ask whoever runs the hub for it. <a href="about/">What is this?</a></p></div></div>`)
    return new Promise(() => {})
  }
  // SSO returns to the hub's own address, which a link visitor cannot hold a session for
  if (link) delete cfg.sso
  const root = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'auth-gate' }))
  // an origin the server does not trust can never sign in: say so first
  root.innerHTML = `<div class="auth-card"><div class="auth-brand"></div>
    ${cfg.originOk === false ? `<p class="auth-warn">This server does not trust <b>${location.origin}</b>.<br>
      Open the app at <b>${(cfg.trustedOrigins || []).map(esc).join('</b> or <b>')}</b>, or set
      <code>TYDIG_URL</code> and <code>TYDIG_ORIGINS</code> to <b>${location.origin}</b> and restart
      (<code>just serve</code>).</p>` : ''}
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
      <p class="auth-err" hidden></p>
      <button type="submit" class="go auth-submit">Sign in</button>
    </form></div>`
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
    root.querySelector('.up-only').hidden = !up
    form.name.required = up // shown on comments, so never made from the address
    submit.textContent = up ? 'Create account' : 'Sign in'
    form.password.autocomplete = up ? 'new-password' : 'current-password'
    err.hidden = true
  })
  if (invite) tabs[1].click()
  return new Promise(resolve => form.onsubmit = async e => {
    e.preventDefault()
    err.hidden = true; submit.disabled = true
    const body = { email: form.email.value, password: form.password.value }
    const res = !up ? await authClient.signIn.email(body) : await authClient.signUp.email({ ...body,
      name: form.name.value.trim(), fetchOptions: invite ? { headers: { 'x-tydig-invite': invite } } : {} })
    submit.disabled = false
    if (res.error) { err.textContent = explain(res.error, form.email.value); err.hidden = false; return }
    if (invite) history.replaceState(null, '', location.href.replace(/[?&]invite=[^&#]*/, ''))
    root.remove(); resolve()
  })
}
