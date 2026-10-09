// Client-side auth: better-auth client, plus a login/register gate that
// blocks the app until there is a session. Sessions are cookie-based, so
// ordinary fetch (credentials: same-origin) and the websocket upgrade both
// carry them automatically.
import { link } from './link.js'
import { createAuthClient } from 'better-auth/client'
import { organizationClient, genericOAuthClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: location.origin,
  plugins: [organizationClient(), genericOAuthClient()],
})

// Returns the session user, drawing a login screen first if needed.
export async function requireUser() {
  for (;;) {
    const { data } = await authClient.getSession()
    if (data?.user) return data.user
    await loginScreen()
  }
}

// The failures people hit, phrased as what to do. By code: a wrong password
// reads "Invalid email or password", which is not a malformed address.
function explain(error, email) {
  const msg = error.message || 'Sign-in failed.'
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD')
    return 'Wrong email or password. No account with this address yet? Use Create account.'
  if (['INVALID_EMAIL', 'VALIDATION_ERROR'].includes(error.code) && /email/i.test(msg)) {
    return `"${email}" isn't a valid address. It needs a dot and a suffix -- ` +
      `bare hosts like name@localhost are rejected. Try you@example.com; ` +
      `nothing is ever sent to it.`
  }
  if (error.code === 'INVALID_ORIGIN' || /invalid origin/i.test(msg)) {
    return `The server does not trust this address (${location.origin}). ` +
      `Open the app at the URL the server was configured with, or set ` +
      `TYDIG_URL and TYDIG_ORIGINS to ${location.origin} and restart.`
  }
  return msg
}

// An invite link (?invite=<id>) opens on Create account and carries its key.
const invite = new URLSearchParams(location.search).get('invite')

async function loginScreen() {
  const cfg = await fetch('/api/auth-config').then(r => r.json()).catch(() => null)
  // tydig's static site with no hub code in the address: nothing to sign in to
  if (!cfg) { // in link mode, link.js already says why the hub is unreachable
    if (!link) document.body.insertAdjacentHTML('beforeend', `<div id="auth-gate"><div class="auth-card">
      <div class="auth-brand">tydig</div><p>This page needs a hub's link: the full address
      ending in <code>#</code> and a code, which the hub prints (<code>just link</code>) and
      shows under Settings &gt; Share. Ask whoever runs the hub for it.</p></div></div>`)
    return new Promise(() => {})
  }
  // SSO returns to the hub's own address, which a link visitor cannot hold a session for
  if (link) delete cfg.sso
  return new Promise(resolve => {
    const root = document.createElement('div')
    root.id = 'auth-gate'
    const sso = cfg.sso ? `
        <button type="button" class="auth-sso">Sign in with ${cfg.sso.label.replace(/[<>&"]/g, '')}</button>
        ${cfg.sso.only ? '' : '<div class="auth-or">or use email</div>'}` : ''
    // If this page's origin isn't one the server trusts, no credentials will
    // ever be accepted. Say so up front instead of after a failed attempt.
    const originWarning = cfg.originOk === false ? `
        <p class="auth-warn">This server does not trust <b>${location.origin}</b>.<br>
        Open the app at <b>${(cfg.trustedOrigins || []).join('</b> or <b>')}</b>,
        or set <code>TYDIG_URL</code> and <code>TYDIG_ORIGINS</code> to
        <b>${location.origin}</b> and restart (<code>just serve</code>).</p>` : ''
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">tydig</div>${originWarning}${sso}
        <div class="auth-tabs"><button data-tab="in" class="on">Sign in</button><button data-tab="up">Create account</button></div>
        <form id="auth-form">
          <label class="up-only" hidden>Name (shown on your comments)<input name="name" autocomplete="name" /></label>
          <label>Email<input name="email" type="email" autocomplete="email" required
            placeholder="you@example.com" /></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8" /></label>
          <p class="auth-err" hidden></p>
          <button type="submit" class="auth-submit">Sign in</button>
        </form>
      </div>`
    document.body.appendChild(root)
    const form = root.querySelector('#auth-form')
    if (cfg.sso) {
      root.querySelector('.auth-sso').onclick = () =>
        authClient.signIn.oauth2({ providerId: cfg.sso.providerId, callbackURL: location.href })
      if (cfg.sso.only) { form.hidden = true; root.querySelector('.auth-tabs').hidden = true }
    }
    const err = root.querySelector('.auth-err')
    const submit = root.querySelector('.auth-submit')
    let mode = 'in'
    root.querySelectorAll('.auth-tabs button').forEach(b => b.onclick = () => {
      mode = b.dataset.tab
      root.querySelectorAll('.auth-tabs button').forEach(x => x.classList.toggle('on', x === b))
      root.querySelector('.up-only').hidden = mode === 'in'
      form.name.required = mode === 'up' // shown on comments, so never derived from the address
      submit.textContent = mode === 'in' ? 'Sign in' : 'Create account'
      form.password.autocomplete = mode === 'in' ? 'current-password' : 'new-password'
      err.hidden = true
    })
    if (invite) root.querySelector('[data-tab="up"]').click()
    form.onsubmit = async e => {
      e.preventDefault()
      err.hidden = true; submit.disabled = true
      const body = { email: form.email.value, password: form.password.value }
      const res = mode === 'in'
        ? await authClient.signIn.email(body)
        : await authClient.signUp.email({ ...body, name: form.name.value.trim(),
          fetchOptions: invite ? { headers: { 'x-tydig-invite': invite } } : {} })
      submit.disabled = false
      if (res.error) {
        err.textContent = explain(res.error, form.email.value)
        err.hidden = false
        return
      }
      if (invite) history.replaceState(null, '', location.href.replace(/[?&]invite=[^&#]*/, ''))
      root.remove(); resolve()
    }
  })
}
