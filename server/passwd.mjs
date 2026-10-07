// Give an account a fresh random password and print it: there is no mail to
// reset by. Signs the account out everywhere.   just passwd ada@example.edu
import { randomBytes } from 'node:crypto'
import { auth, db } from './auth.mjs'
const u = db.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(process.argv[2] ?? '')
if (!u) { console.error(`no account for ${process.argv[2]}`); process.exit(1) }
const ctx = await auth.$context, pw = randomBytes(12).toString('base64url')
await ctx.internalAdapter.updatePassword(u.id, await ctx.password.hash(pw))
await ctx.internalAdapter.deleteUserSessions(u.id)
console.log(pw)
