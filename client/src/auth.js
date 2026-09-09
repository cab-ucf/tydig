// Client-side auth: better-auth client, plus a login/register gate that
// blocks the app until there is a session. Sessions are cookie-based, so
// ordinary fetch (credentials: same-origin) and the websocket upgrade both
// carry them automatically.
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

// The two failures people hit on a fresh install, phrased as what to do.
function explain(error, email) {
  const msg = error.message || 'Sign-in failed.'
  if (/invalid email/i.test(msg)) {
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

async function loginScreen() {
  const cfg = await fetch('/api/auth-config').then(r => r.json()).catch(() => ({}))
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
          <label class="up-only" hidden>Name<input name="name" autocomplete="name" /></label>
          <label>Email<input name="email" type="email" autocomplete="email" required
            placeholder="you@example.com" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" /></label>
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
      submit.textContent = mode === 'in' ? 'Sign in' : 'Create account'
      form.password.autocomplete = mode === 'in' ? 'current-password' : 'new-password'
      err.hidden = true
    })
    form.onsubmit = async e => {
      e.preventDefault()
      err.hidden = true; submit.disabled = true
      const body = { email: form.email.value, password: form.password.value }
      const res = mode === 'in'
        ? await authClient.signIn.email(body)
        : await authClient.signUp.email({ ...body, name: form.name.value || form.email.value.split('@')[0] })
      submit.disabled = false
      if (res.error) {
        err.textContent = explain(res.error, form.email.value)
        err.hidden = false
        return
      }
      root.remove(); resolve()
    }
  })
}
