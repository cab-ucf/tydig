// Authentication + project ownership/sharing via better-auth.
// Email/password (scrypt), sessions, and the organization plugin: each
// project is owned by a user and shared by adding members. SQLite single file.
import { betterAuth } from 'better-auth'
import { organization, genericOAuth } from 'better-auth/plugins'
import { getMigrations } from 'better-auth/db/migration'
import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
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

export const auth = betterAuth({
  database: db,
  secret: SECRET,
  baseURL: process.env.TYDIG_URL || 'http://localhost:5173',
  trustedOrigins: withLoopbackTwins(configuredOrigins),
  emailAndPassword: { enabled: !(ssoInfo?.only), autoSignIn: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
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
export async function getSession(req) {
  return auth.api.getSession({ headers: req.headers })
}

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

export { SECRET, db }
