// Accounts (better-auth, one SQLite file) and projects as organizations:
// slug == project folder, membership == sharing.
import { betterAuth } from 'better-auth'
import { organization, genericOAuth } from 'better-auth/plugins'
import { getMigrations } from 'better-auth/db/migration'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { verifyPassword } from 'better-auth/crypto'
import Database from 'better-sqlite3'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA } from './store.mjs'

const env = process.env
const secretFile = path.join(DATA, '.auth-secret')
if (!env.TYDIG_SECRET && !existsSync(secretFile))
  writeFileSync(secretFile, randomBytes(32).toString('base64url'), { mode: 0o600 })
export const db = new Database(path.join(DATA, 'auth.db'))
db.pragma('journal_mode = WAL')

// any OpenID Connect IdP: redirect URI <origin>/api/auth/oauth2/callback/sso
export const sso = env.TYDIG_SSO_DISCOVERY ? {
  providerId: 'sso', label: env.TYDIG_SSO_LABEL || 'Institution SSO', only: env.TYDIG_SSO_ONLY === '1',
} : null

// CSRF: trusted origins, each with its loopback twin (localhost/127.0.0.1)
export const TRUSTED = [...new Set((env.TYDIG_ORIGINS || env.TYDIG_URL || 'http://localhost:3000')
  .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean)
  .flatMap(o => [o, o.replace('//localhost', '//127.0.0.1'), o.replace('//127.0.0.1', '//localhost')]))]
const glob = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
export const originOk = o => !o || TRUSTED.some(p => /[*?]/.test(p) ? glob(p).test(o) : p === o)

// scrypt at OWASP's cost, s2$salt$key; older better-auth hashes still verify
const S = { N: 1 << 16, r: 8, p: 2, maxmem: 160 << 20 }, kdf = promisify(scrypt)
const key = (pw, salt) => kdf(pw.normalize('NFKC'), salt, 64, S)
const password = {
  hash: async pw => { const s = randomBytes(16).toString('hex'); return `s2$${s}$${(await key(pw, s)).toString('hex')}` },
  verify: async ({ hash, password: pw }) => {
    if (!hash.startsWith('s2$')) return verifyPassword({ hash, password: pw })
    const [, s, k] = hash.split('$')
    return timingSafeEqual(Buffer.from(k, 'hex'), await key(pw, s))
  },
}

// sign-in attempts per account, whatever address they come from
const tries = new Map()
const tooMany = email => {
  const k = String(email).toLowerCase(), now = Date.now()
  const t = (tries.get(k) || []).filter(x => now - x < 15 * 60_000)
  tries.set(k, [...t, now])
  return t.length >= 10
}

// Join codes: three spoken words (cxn.pub, "tidy ruby otter") that let
// whoever holds them sign up and join one project for a week. They can only
// be guessed against the hub, so wrong ones are capped hub-wide.
db.exec('CREATE TABLE IF NOT EXISTS joincode (code TEXT PRIMARY KEY, org TEXT, expires INTEGER)')
const WORDS = readFileSync(path.join(import.meta.dirname, 'words.txt'), 'utf8').trim().split('\n')
const norm = c => (String(c || '').toLowerCase().match(/[a-z]+/g) || []).join('-')
let misses = [] // [time, address] of wrong codes: 10 per address, 100 hub-wide, per 15 minutes
export const joins = {
  add: org => {
    const b = randomBytes(12), code = [0, 4, 8].map(i => WORDS[b.readUInt32LE(i) % WORDS.length]).join('-')
    db.prepare('DELETE FROM joincode WHERE expires < ?').run(Date.now())
    db.prepare('INSERT INTO joincode VALUES (?, ?, ?)').run(norm(code), org, Date.now() + 7 * 86400_000)
    return code
  },
  list: org => db.prepare('SELECT code, expires FROM joincode WHERE org = ? AND expires > ?').all(org, Date.now()),
  drop: (org, code) => db.prepare('DELETE FROM joincode WHERE org = ? AND code = ?').run(org, norm(code)),
  org: (code, ip) => {
    misses = misses.filter(([t]) => Date.now() - t < 15 * 60_000)
    if (misses.length >= 100 || misses.filter(([, a]) => a === ip).length >= 10)
      no('TOO_MANY_REQUESTS', 'Too many wrong codes lately; try again in 15 minutes.')
    const r = db.prepare('SELECT org FROM joincode WHERE code = ? AND expires > ?').get(norm(code), Date.now())
    if (!r) misses.push([Date.now(), ip])
    return r?.org
  },
}

// After the first account, signing up takes a join code, or an invitation
// (sharing a project with an address makes one) and its id from the invite link.
const OPEN = env.TYDIG_SIGNUP === 'open', MAX_PROJECTS = Number(env.TYDIG_MAX_PROJECTS || 50)
const invitesFor = email => db.prepare("SELECT * FROM invitation WHERE lower(email) = lower(?) " +
  "AND status = 'pending'").all(String(email)).filter(i => new Date(i.expiresAt) > new Date())
const no = (code, message) => { throw new APIError(code, { message }) }
const gate = createAuthMiddleware(async ctx => {
  if (ctx.request && /^\/organization\/(create|update|delete)$/.test(ctx.path))
    no('FORBIDDEN', 'projects are created and removed through tydig')
  if (ctx.path === '/sign-in/email' && tooMany(ctx.body?.email))
    no('TOO_MANY_REQUESTS', 'Too many sign-in attempts for this account; try again in 15 minutes.')
  if ((ctx.path === '/sign-up/email' || ctx.path === '/update-user' && 'name' in (ctx.body || {})) && !String(ctx.body?.name || '').trim())
    no('BAD_REQUEST', 'Give a name: collaborators see it.')
  if (ctx.path !== '/sign-up/email') return
  const invite = ctx.headers?.get?.('x-tydig-invite'), join = ctx.headers?.get?.('x-tydig-join')
  if (OPEN || !db.prepare('SELECT 1 FROM user').get() || invitesFor(ctx.body?.email).some(i => i.id === invite)) return
  if (join) { if (joins.org(join, ctx.headers?.get?.('x-tydig-ip'))) return; no('FORBIDDEN', 'That code is wrong or has expired: ask for a new one.') }
  no('FORBIDDEN', invite ? 'This invite link is for another address, or has expired.'
      : 'This hub is invite-only: ask a project owner for a code.')
})

// a deleted account's projects pass to an admin, else the oldest member;
// one nobody else is in goes with it (index.mjs removes its files)
export const lifecycle = { dropProject: async () => {} }
// what only a project's owner or an admin may do
export const admin = (req, res, next) => ['owner', 'admin'].includes(req.org?.role) ? next()
  : res.status(403).json({ error: 'only the project\'s owner or an admin can do that' })
async function handOver(u) {
  const q = s => db.prepare(s)
  for (const { organizationId: o } of q("SELECT organizationId FROM member WHERE userId = ? AND role = 'owner'").all(u.id)) {
    if (q("SELECT 1 FROM member WHERE organizationId = ? AND role = 'owner' AND userId != ?").get(o, u.id)) continue
    const heir = q("SELECT id FROM member WHERE organizationId = ? AND userId != ? " +
      "ORDER BY role = 'admin' DESC, createdAt LIMIT 1").get(o, u.id)
    if (heir) { q("UPDATE member SET role = 'owner' WHERE id = ?").run(heir.id); continue }
    await lifecycle.dropProject(q('SELECT slug FROM organization WHERE id = ?').get(o).slug)
    q('DELETE FROM organization WHERE id = ?').run(o)
  }
}

export const auth = betterAuth({
  database: db,
  secret: env.TYDIG_SECRET || readFileSync(secretFile, 'utf8').trim(),
  baseURL: env.TYDIG_URL || 'http://localhost:3000',
  trustedOrigins: TRUSTED,
  emailAndPassword: { enabled: !sso?.only, autoSignIn: true, password },
  user: { deleteUser: { enabled: true, beforeDelete: handOver } },
  session: { expiresIn: 30 * 86400, updateAge: 86400 },
  advanced: { ipAddress: { ipAddressHeaders: ['x-tydig-ip'] } }, // set by index.mjs
  hooks: { before: gate },
  // an invitation is taken by its link, or by an address the IdP vouches for
  databaseHooks: { user: { create: { after: async (u, ctx) => {
    const key = ctx?.headers?.get?.('x-tydig-invite')
    for (const i of invitesFor(u.email).filter(i => u.emailVerified || i.id === key)) {
      await auth.api.addMember({ body: { userId: u.id, organizationId: i.organizationId, role: i.role || 'member' } })
      db.prepare("UPDATE invitation SET status = 'accepted' WHERE id = ?").run(i.id)
    }
  } } } },
  plugins: [
    ...sso ? [genericOAuth({ config: [{
      providerId: 'sso', discoveryUrl: env.TYDIG_SSO_DISCOVERY, pkce: true,
      clientId: env.TYDIG_SSO_CLIENT_ID, clientSecret: env.TYDIG_SSO_CLIENT_SECRET,
      scopes: ['openid', 'profile', 'email'],
    }] })] : [],
    organization({ allowUserToCreateOrganization: true, creatorRole: 'owner', organizationLimit: u => // owned
      db.prepare("SELECT count(*) n FROM member WHERE userId = ? AND role = 'owner'").get(u.id).n >= MAX_PROJECTS }),
  ],
})
await (await getMigrations(auth.options)).runMigrations()

// the session behind a cookie (or a bare token), or null
export const session = (cookie, token) => auth.api.getSession({ headers: new Headers({
  cookie: cookie || (token ? `better-auth.session_token=${token}` : ''),
}) }).catch(() => null)

const mine = db.prepare('SELECT o.id, o.slug AS name, m.role FROM member m ' +
  'JOIN organization o ON o.id = m.organizationId WHERE m.userId = ?')
const one = db.prepare('SELECT o.id, o.slug AS name, m.role FROM member m ' +
  'JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? AND o.slug = ?')
export const projectsOf = userId => mine.all(userId)
export const access = (userId, slug) => one.get(userId, slug) || null
export const userByEmail = email => db.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(email)
