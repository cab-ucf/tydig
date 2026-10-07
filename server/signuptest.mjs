// Invite-only sign-up, the default: the first account is free, strangers are
// refused, and sharing a project with an address is what lets it register.
const B = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const signup = email => fetch(`${B}/api/auth/sign-up/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: B },
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
const bobRes = await signup('bob@example.com')
check('the invited address signs up', bobRes.ok)
const bob = jar(bobRes)
check('and finds the project waiting', (await (await as(bob, '/projects')).json()).some(p => p.name === 'paper'))
const org = await (await as(ann, '/auth/organization/get-full-organization?organizationSlug=paper')).json()
const bobId = org.members.find(m => m.user.email === 'bob@example.com').id
check('a member cannot remove the owner',
  (await as(bob, `/p/paper/members/${org.members.find(m => m.role === 'owner').id}`, { method: 'DELETE' })).status >= 400)
check('the owner removes a member', (await as(ann, `/p/paper/members/${bobId}`, { method: 'DELETE' })).ok)
check('who then loses access', (await as(bob, '/p/paper/files')).status === 403)

console.log(pass ? '\nSIGNUP ALL PASS' : '\nSIGNUP FAILURES')
process.exit(pass ? 0 : 1)
