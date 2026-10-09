// Invite-only sign-up, the default: the first account is free, strangers are
// refused, and sharing a project with an address is what lets it register.
const B = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const signup = (email, invite) => fetch(`${B}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...(invite && { 'x-tydig-invite': invite }) },
  body: JSON.stringify({ email, password: 'password123', name: email.split('@')[0] }),
})
const jar = r => r.headers.getSetCookie()[0].split(';')[0]
const as = (cookie, p, o = {}) => fetch(`${B}/api${p}`,
  { ...o, headers: { cookie, origin: B, 'content-type': 'application/json' } })

const ann = jar(await signup('ann@example.com'))
check('first account signs up', !!ann)
check('a stranger is refused', (await signup('eve@example.com')).status === 403)
await as(ann, '/projects/paper', { method: 'POST' })
const shared = await (await as(ann, '/p/paper/members',
  { method: 'POST', body: JSON.stringify({ email: 'Bob@Example.com' }) })).json()
check('sharing with an address that has no account invites it', shared.invited === true)
check('an invited address alone cannot sign up (anyone could claim it)', (await signup('bob@example.com')).status === 403)
check('nor with another invitation\'s key', (await signup('bob@example.com', 'not-the-key')).status === 403)
const bobRes = await signup('bob@example.com', shared.invite)
check('the invited address signs up with its invite link', bobRes.ok)
const bob = jar(bobRes)
check('and finds the project waiting', (await (await as(bob, '/projects')).json()).some(p => p.name === 'paper'))
// what the security review found, kept fixed
const raw = (cookie, method, path, body) => new Promise(ok => { // a path with ./ left in, as curl --path-as-is sends
  import('node:http').then(({ request }) => {
    const q = request({ host: 'localhost', port: 3000, method, path, headers: { cookie, origin: B, 'content-type': 'application/json' } },
      res => { res.resume(); ok(res.statusCode) })
    q.end(body ? JSON.stringify(body) : undefined)
  })
})
check('no one claims a hub directory as a project, ./ or not',
  (await raw(bob, 'POST', '/api/auth/./organization/create', { name: 'g', slug: 'gitsync' })) === 403 &&
  (await raw(bob, 'POST', '/api/auth/organization/create', { name: 'g', slug: 'gitsync' })) === 403)
check('the hub directories are never served as projects', (await as(ann, '/p/gitsync/raw/known_hosts')).status === 404)
check('a member cannot point the project at a remote or a peer',
  (await as(bob, '/p/paper/gitremote', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/x.git' }) })).status === 403 &&
  (await as(bob, '/p/paper/federation/invite', { method: 'POST' })).status === 403)
const { statSync, existsSync } = await import('node:fs')
check('auth.db (hashes, sessions) is readable by the hub user alone', (statSync('data/auth.db').mode & 0o077) === 0 && (statSync('data').mode & 0o077) === 0)

const org = await (await as(ann, '/auth/organization/get-full-organization?organizationSlug=paper')).json()
const bobId = org.members.find(m => m.user.email === 'bob@example.com').id
check('a member cannot remove the owner',
  (await as(bob, `/p/paper/members/${org.members.find(m => m.role === 'owner').id}`, { method: 'DELETE' })).status >= 400)
check('the owner removes a member', (await as(ann, `/p/paper/members/${bobId}`, { method: 'DELETE' })).ok)
check('who then loses access', (await as(bob, '/p/paper/files')).status === 403)

// the rest of the review
check('a name is required (it, not the address, is shown on comments)', (await fetch(`${B}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ email: 'x@example.com', password: 'password123', name: ' ' }) })).status === 400)
const Database = (await import('better-sqlite3')).default, adb = new Database('data/auth.db', { readonly: true })
check('passwords are stored as strong scrypt hashes (s2$)', adb.prepare("SELECT password FROM account WHERE password IS NOT NULL").all().every(r => r.password.startsWith('s2$')))
check('a remote on the hub\'s own network is refused', /own network/.test((await (await as(ann, '/p/paper/gitremote',
  { method: 'POST', body: JSON.stringify({ url: 'https://169.254.169.254/x.git' }) })).json()).error || ''))

// deleting an account: a shared project passes to the longest-standing member, a solo one goes
const inv = await (await as(ann, '/p/paper/members', { method: 'POST', body: JSON.stringify({ email: 'cat@example.com' }) })).json()
const cat = jar(await signup('cat@example.com', inv.invite))
await as(ann, '/projects/solo', { method: 'POST' })
check('the solo project exists before', existsSync('data/solo/.git'))
const del = await as(ann, '/auth/delete-user', { method: 'POST', body: JSON.stringify({ password: 'password123' }) })
check('an account can delete itself', del.ok)
const after = await (await as(cat, '/auth/organization/get-full-organization?organizationSlug=paper')).json()
check('its shared project now belongs to the remaining member', after.members?.find(m => m.user.email === 'cat@example.com')?.role === 'owner')
check('who keeps working in it', (await as(cat, '/p/paper/files')).ok)
check('a project nobody else was in is gone, files and all', !existsSync('data/solo'))
check('and the deleted account is signed out', (await as(ann, '/projects')).status === 401)

console.log(pass ? '\nSIGNUP ALL PASS' : '\nSIGNUP FAILURES')
process.exit(pass ? 0 : 1)
