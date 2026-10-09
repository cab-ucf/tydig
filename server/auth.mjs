// Authentication + project ownership/sharing via better-auth.
// Email/password (scrypt), sessions, and the organization plugin: each
// project is owned by a user and shared by adding members. SQLite single file.
import { betterAuth } from 'better-auth'
import { organization, genericOAuth } from 'better-auth/plugins'
import { getMigrations } from 'better-auth/db/migration'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import Database from 'better-sqlite3'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { verifyPassword } from 'better-auth/crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Same rule as index.mjs: TYDIG_DATA is the one place state lives.
const DATA = path.resolve(process.env.TYDIG_DATA || 'data')
await mkdir(DATA, { recursive: true })

// Persisted server secret (rotating it invalidates sessions; keep it stable).
const secretFile = path.join(DATA, '.auth-secret')
const SECRET = process.env.TYDIG_SECRET ||
  (existsSync(secretFile) ? (await readFile(secretFile, 'utf8')).trim()
    : await (async () => { const s = randomBytes(32).toString('base64url'); await writeFile(secretFile, s, { mode: 0o600 }); return s })())

const db = new Database(path.join(DATA, 'auth.db'))
db.pragma('journal_mode = WAL')

// ---- SSO: any OpenID Connect identity provider, configured by env ----
// Universities and labs point this at their existing IdP (Keycloak,
// Shibboleth's OIDC plugin, Microsoft Entra ID, Google Workspace, Authentik):
//   TYDIG_SSO_DISCOVERY  https://idp.example.edu/.well-known/openid-configuration
//   TYDIG_SSO_CLIENT_ID / TYDIG_SSO_CLIENT_SECRET   (register a
//     confidential client with redirect URI <origin>/api/auth/oauth2/callback/sso)
//   TYDIG_SSO_LABEL      button text, e.g. "Example University"
// Accounts are matched/created by the email the IdP asserts; local
// email+password stays available unless TYDIG_SSO_ONLY=1.
export const ssoInfo = process.env.TYDIG_SSO_DISCOVERY ? {
  providerId: 'sso',
  label: process.env.TYDIG_SSO_LABEL || 'Institution SSO',
  only: process.env.TYDIG_SSO_ONLY === '1',
} : null

// Trusted origins gate every auth request (CSRF). Whatever you configure,
// localhost and 127.0.0.1 name the same server, and people type both -- so
// each origin's loopback twin is trusted too. Without this, opening the app
// at 127.0.0.1 while TYDIG_URL says localhost fails sign-in with
// "Invalid origin", which looks like a bug rather than a config mismatch.
// Origins are compared to the browser's Origin header by exact string, so a
// stray trailing slash or space silently never matches. Normalise both away.
const configuredOrigins = (process.env.TYDIG_ORIGINS ||
  'http://localhost:5173,http://localhost:3000')
  .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean)
export const trustedOrigins = () => withLoopbackTwins(configuredOrigins)
const withLoopbackTwins = origins => [...new Set(origins.flatMap(o => [
  o,
  o.replace('//localhost', '//127.0.0.1'),
  o.replace('//127.0.0.1', '//localhost'),
]))]

// Sign-up: the first account is free (whoever installs the hub). After that,
// an email sign-up needs a pending invitation, which sharing a project with
// an address creates; the account joins those projects as it is created. SSO
// sign-ins skip the check: the institution's IdP is the gate.
// TYDIG_SIGNUP=open lets anyone who can reach the hub register.
const OPEN = process.env.TYDIG_SIGNUP === 'open'
const invitesFor = email => db.prepare(
  "SELECT * FROM invitation WHERE lower(email) = lower(?) AND status = 'pending'")
  .all(String(email)).filter(i => new Date(i.expiresAt) > new Date())

// Passwords: scrypt at OWASP's recommended cost (N=2^16, r=8, p=2, 64 MiB),
// stored as s2$salt$key. Hashes from before (better-auth's lighter default,
// salt:key) still verify; they move up when the password next changes.
const S = { N: 1 << 16, r: 8, p: 2, maxmem: 160 << 20 }, kdf = promisify(scrypt)
const password = {
  hash: async pw => { const salt = randomBytes(16).toString('hex'); return `s2$${salt}$${(await kdf(pw.normalize('NFKC'), salt, 64, S)).toString('hex')}` },
  verify: async ({ hash, password: pw }) => {
    if (!hash.startsWith('s2$')) return verifyPassword({ hash, password: pw })
    const [, salt, key] = hash.split('$')
    return timingSafeEqual(Buffer.from(key, 'hex'), await kdf(pw.normalize('NFKC'), salt, 64, S))
  },
}

// Sign-in attempts per account, whoever makes them: per-visitor limits alone
// let someone who keeps changing address (or iroh id) guess passwords forever.
const tries = new Map(), TRIES = 10, WINDOW = 15 * 60_000
const tooMany = email => {
  const k = String(email).toLowerCase(), now = Date.now(), t = (tries.get(k) || []).filter(x => now - x < WINDOW)
  tries.set(k, [...t, now])
  return t.length >= TRIES
}

// Deleting an account: each project it alone owns passes to an admin, else
// to the longest-standing member; one with nobody else in it is deleted
// (index.mjs removes its files: dropProject).
export const lifecycle = { dropProject: async () => {} }
async function handOver(u) {
  for (const { organizationId: org } of db.prepare("SELECT organizationId FROM member WHERE userId = ? AND role = 'owner'").all(u.id)) {
    if (db.prepare("SELECT 1 FROM member WHERE organizationId = ? AND role = 'owner' AND userId != ?").get(org, u.id)) continue
    const heir = db.prepare("SELECT id FROM member WHERE organizationId = ? AND userId != ? ORDER BY role = 'admin' DESC, createdAt LIMIT 1").get(org, u.id)
    if (heir) { db.prepare("UPDATE member SET role = 'owner' WHERE id = ?").run(heir.id); continue }
    await lifecycle.dropProject(db.prepare('SELECT slug FROM organization WHERE id = ?').get(org).slug)
    db.prepare('DELETE FROM organization WHERE id = ?').run(org)
  }
}

export const auth = betterAuth({
  database: db,
  secret: SECRET,
  baseURL: process.env.TYDIG_URL || 'http://localhost:5173',
  trustedOrigins: withLoopbackTwins(configuredOrigins),
  emailAndPassword: { enabled: !(ssoInfo?.only), autoSignIn: true, password },
  user: { deleteUser: { enabled: true, beforeDelete: handOver } },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  // set by index.mjs from the socket (or a trusted proxy): never client-chosen
  advanced: { ipAddress: { ipAddressHeaders: ['x-tydig-ip'] } },
  hooks: {
    before: createAuthMiddleware(async ctx => {
      // Projects are organizations keyed by slug == directory: only the hub
      // itself (no HTTP request) creates, renames or deletes one. Checked on
      // the routed path, which has had its ./ and ../ removed.
      if (ctx.request && /^\/organization\/(create|update|delete)$/.test(ctx.path))
        throw new APIError('FORBIDDEN', { message: 'projects are created and removed through tydig' })
      if (ctx.path === '/sign-in/email' && tooMany(ctx.body?.email)) throw new APIError('TOO_MANY_REQUESTS', {
        message: 'Too many sign-in attempts for this account; try again in 15 minutes.' })
      // the name, not the address, is what comments show to everyone
      if (ctx.path === '/sign-up/email' && !String(ctx.body?.name || '').trim()) throw new APIError('BAD_REQUEST', {
        message: 'Give a name: it is what collaborators see on your comments.' })
      // An invited address signs up with its invite link (x-tydig-invite: the
      // invitation's id): knowing or guessing the address alone is not enough.
      const key = ctx.headers?.get?.('x-tydig-invite')
      if (ctx.path === '/sign-up/email' && !OPEN && db.prepare('SELECT 1 FROM user').get() &&
        !invitesFor(ctx.body?.email).some(i => i.id === key)) throw new APIError('FORBIDDEN', {
        message: key ? 'This invite link is not for that address (or has expired): sign up with the ' +
          'address it was sent to, or ask for a new one.' : 'This hub already has accounts and is ' +
          'invite-only. If one is yours, use Sign in (forgotten password: run `just passwd` on the ' +
          'hub). Otherwise ask a project owner to share a project with your address and send you the invite link.' })
    }),
  },
  databaseHooks: { user: { create: { after: async u => {
    for (const i of invitesFor(u.email)) {
      await auth.api.addMember({ body: { userId: u.id, organizationId: i.organizationId, role: i.role || 'member' } })
      db.prepare("UPDATE invitation SET status = 'accepted' WHERE id = ?").run(i.id)
    }
  } } } },
  plugins: [
    ...(ssoInfo ? [genericOAuth({
      config: [{
        providerId: 'sso',
        discoveryUrl: process.env.TYDIG_SSO_DISCOVERY,
        clientId: process.env.TYDIG_SSO_CLIENT_ID,
        clientSecret: process.env.TYDIG_SSO_CLIENT_SECRET,
        scopes: ['openid', 'profile', 'email'],
        pkce: true,
      }],
    })] : []),
    organization({
      // a "project" is an organization; membership = sharing
      allowUserToCreateOrganization: true,
      organizationLimit: 1000,
      creatorRole: 'owner',
    }),
  ],
})

// Apply better-auth's schema (idempotent: only runs pending migrations).
const { runMigrations } = await getMigrations(auth.options)
await runMigrations()

// ---- helpers used by the main server ----
// Resolve which projects (orgs) a user may access, by slug == project dir name.
// listOrganizations omits the caller's role, so we join it from the member table.
export async function userProjects(headers) {
  const sess = await auth.api.getSession({ headers }).catch(() => null)
  if (!sess?.user) return new Map()
  const orgs = await auth.api.listOrganizations({ headers }).catch(() => [])
  const roleFor = db.prepare(
    'SELECT role FROM member WHERE organizationId = ? AND userId = ?')
  return new Map(orgs.map(o => {
    const row = roleFor.get(o.id, sess.user.id)
    return [o.slug, { ...o, role: row?.role || 'member' }]
  }))
}

// Authorize a user for a given project slug; returns the org or null.
export async function authorizeProject(headers, slug) {
  const orgs = await userProjects(headers)
  return orgs.get(slug) || null
}

export { db }
