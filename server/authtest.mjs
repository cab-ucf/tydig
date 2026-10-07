// End-to-end auth + sharing over real HTTP against the running server.
const B = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }

// cookie jar per user
const O = 'http://localhost:3000'  // browsers send Origin; better-auth checks it (CSRF)
const signup = async (email, name) => {
  const r = await fetch(`${B}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: O },
    body: JSON.stringify({ email, password: 'password123', name }),
  })
  const c = r.headers.getSetCookie?.()?.[0]?.split(';')[0]
  return { cookie: c, ok: r.ok }
}
const as = (jar, p, opt = {}) => fetch(`${B}/api${p}`, { ...opt, headers: { ...opt.headers, cookie: jar.cookie, origin: O } })

const ann = await signup(`ann${Date.now()}@t.co`, 'Ann')
const bob = await signup(`bob${Date.now()}@t.co`, 'Bob')
check('Ann signs up (session cookie)', ann.ok && !!ann.cookie)
check('Bob signs up', bob.ok && !!bob.cookie)

// unauthenticated request rejected
check('no-session /api/projects -> 401', (await fetch(`${B}/api/projects`)).status === 401)

// /api/me reflects session
const meAnn = await (await as(ann, '/me')).json()
check('/api/me returns Ann', meAnn.name === 'Ann')

// Ann creates a project (= organization)
const proj = 'shared' + Date.now().toString(36)
const cr = await (await as(ann, `/projects/${proj}`, { method: 'POST' })).json()
check('Ann creates project', cr.ok === true)

// Ann sees it; Bob does not
const annList = await (await as(ann, '/projects')).json()
const bobList = await (await as(bob, '/projects')).json()
check('Ann lists her project as owner', annList.some(p => p.name === proj && p.role === 'owner'))
check('Bob does NOT see Ann project', !bobList.some(p => p.name === proj))

// Bob is blocked from Ann's project files
check('Bob blocked from project files (403)', (await as(bob, `/p/${proj}/files`)).status === 403)
// Ann can read her files
check('Ann reads her project files', (await as(ann, `/p/${proj}/files`)).ok)

// Ann shares with Bob by adding his account; only owners may share
const bobEmail = (await (await as(bob, '/me')).json()).email
const post = (jar, p, body) => as(jar, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
check('Bob cannot add himself', (await post(bob, `/p/${proj}/members`, { email: bobEmail })).status === 403)
check('unknown email invited', (await (await post(ann, `/p/${proj}/members`, { email: 'nobody@t.co' })).json()).invited === true)
check('Ann adds Bob', (await (await post(ann, `/p/${proj}/members`, { email: bobEmail })).json()).ok === true)
check('Bob now sees and reads the project', (await (await as(bob, '/projects')).json()).some(p => p.name === proj) &&
  (await as(bob, `/p/${proj}/files`)).ok)

// Hardening: none of these may reach git, the disk outside a project, or another project
const { existsSync } = await import('node:fs')
check('orgs cannot be minted over HTTP (slug would claim gitsync/)',
  (await post(ann, '/auth/organization/create', { name: 'gitsync', slug: 'gitsync' })).status === 403)
check('adopting a local path refused (would read other projects)',
  (await post(bob, '/projects/steal' + Date.now().toString(36), { gitUrl: `${process.cwd()}/data/${proj}` })).status === 400)
await post(bob, '/projects/inj' + Date.now().toString(36), { gitUrl: 'https://example.com/x.git', branch: '--upload-pack=touch data/PWNED' })
await post(ann, `/p/${proj}/gitremote`, { url: 'https://example.com/x.git', branch: '--receive-pack=touch data/PWNED' })
check('branch cannot inject git options', !existsSync('data/PWNED'))
check('.git unreachable through raw files',
  (await as(ann, `/p/${proj}/raw/.git/config`, { method: 'PUT', body: '[core]' })).status === 400)
check('untrusted origin cannot POST', (await fetch(`${B}/api/projects/x${Date.now()}`, { method: 'POST', headers: { cookie: ann.cookie, origin: 'http://evil.example.net' } })).status === 403)

// Origin handling: the loopback twin of a trusted origin is accepted (people
// type both), while a foreign origin or a different port is not.
const signUpFrom = (origin, email) => fetch(`${B}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ email, password: 'password123', name: 'Origin' }),
}).then(r => r.json())
const twin = await signUpFrom('http://127.0.0.1:3000', `twin${Date.now()}@example.com`)
check('loopback twin of a trusted origin accepted', !!twin.token)
const foreign = await signUpFrom('http://evil.example.net', `evil${Date.now()}@example.com`)
check('foreign origin rejected', foreign.code === 'INVALID_ORIGIN')
check('rejection names the refused origin and what is trusted',
  /evil\.example\.net/.test(foreign.message) && Array.isArray(foreign.trusted) &&
  foreign.trusted.some(o => o.includes('3000')))
const wrongPort = await signUpFrom('http://localhost:9999', `wp${Date.now()}@example.com`)
check('same host, wrong port rejected', wrongPort.code === 'INVALID_ORIGIN')
// Sloppy config must still work: trailing slashes and spaces are normalised
// away, since origins are compared to the Origin header by exact string.
const cfgDiag = await fetch(`${B}/api/auth-config`, { headers: { origin: B } }).then(r => r.json())
check('auth-config reports trusted origins and origin verdict',
  Array.isArray(cfgDiag.trustedOrigins) && cfgDiag.originOk === true && cfgDiag.yourOrigin === B)
check('trusted origins carry no trailing slash or spaces',
  cfgDiag.trustedOrigins.every(o => o === o.trim() && !o.endsWith('/')))
const badOriginDiag = await fetch(`${B}/api/auth-config`, { headers: { origin: 'http://nope.example.net' } }).then(r => r.json())
check('auth-config flags an untrusted origin before any sign-in attempt',
  badOriginDiag.originOk === false)

const badEmail = await signUpFrom(B, 'ada@localhost')
check('bare-host email rejected by validation', badEmail.code === 'VALIDATION_ERROR')

console.log(pass ? '\nAUTH ALL PASS' : '\nAUTH FAILURES')
process.exit(pass ? 0 : 1)
