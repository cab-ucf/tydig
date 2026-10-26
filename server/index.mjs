// The hub: one port for the client, REST, auth, sync (/sync) and LSP (/lsp).
// Each feature is a module; this file only wires them.
import './private.mjs'
import express from 'express'
import compression from 'compression'
import { toNodeHandler } from 'better-auth/node'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { WebSocketServer } from 'ws'
import { DATA, HUB, hubFile, proj, okName, isProj, commit, ensureRepo, hocuspocus, save, dropped, epoch, edited } from './store.mjs'
import { auth, sso, TRUSTED, originOk, session, projectsOf, access, userByEmail, lifecycle, joins, db, admin }
  from './auth.mjs'
import * as build from './build.mjs'
import * as files from './files.mjs'
import * as history from './history.mjs'
import * as remote from './remote.mjs'
import * as templates from './templates.mjs'
import * as agents from './agents.mjs'
import * as assist from './assist.mjs'
import * as link from './link.mjs'
import * as packages from './packages.mjs'

const PORT = Number(process.env.PORT || 3000)
const app = express().disable('x-powered-by')
// No answer says where things live on this machine: errors from git, podman
// or the filesystem name the data folder, so it never leaves as written.
app.use((req, res, next) => {
  res.json = b => res.type('json').send((JSON.stringify(b) ?? '').replaceAll(DATA, '…'))
  next()
})
const TP = process.env.TYDIG_TRUST_PROXY // behind a proxy: hops, 'loopback' or addresses
app.set('trust proxy', isNaN(TP) ? TP ?? false : +TP)
app.use(compression())
// The preview is compiler-made SVG: no inline script, handlers or
// javascript: URLs ('unsafe-eval': the typst wasm needs new Function).
// localhost: a person's own models; Crossref and PubMed: citations.
const CSP = `default-src 'self'; connect-src 'self' ${TRUSTED.map(o => o.replace(/^http/, 'ws')).join(' ')} ` +
  'http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* ' +
  "https://api.crossref.org https://eutils.ncbi.nlm.nih.gov; script-src 'self' 'unsafe-eval'; " +
  "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
app.use((req, res, next) => {
  if (req.socket.link) req.headers.origin = TRUSTED[0]
  res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
    ...process.env.TYDIG_URL?.startsWith('https:') && { 'Strict-Transport-Security': 'max-age=31536000' } })
  next()
})

// accounts; projects (organizations) are made and removed by the hub alone
app.all('/api/auth/*splat', (req, res, next) => {
  if (/^\/api\/auth\/organization\/(create|update|delete)\b/.test(new URL(req.originalUrl, 'http://h').pathname))
    return res.status(403).json({ error: 'projects are created and removed through tydig' })
  if (!originOk(req.headers.origin)) return res.status(403).json({ code: 'INVALID_ORIGIN',
    message: `This hub does not trust ${req.headers.origin}: open it at the address it was set up with (TYDIG_URL).` })
  req.headers['x-tydig-ip'] = req.socket.ip || req.ip
  req.headers['x-tydig-link'] = req.socket.link ? '1' : ''
  next()
}, toNodeHandler(auth))
app.get('/api/auth-config', (req, res) => res.json({
  sso: sso && { providerId: sso.providerId, label: sso.label, only: sso.only },
  originOk: originOk(req.headers.origin), linkOnline: link.online,
}))
app.use('/api/agent/:proj', agents.mcp)

// the rest: a session, and a trusted origin for all but plain GETs
app.use('/api', async (req, res, next) => {
  if (!(req.method === 'GET' && req.path !== '/bridge') && !originOk(req.headers.origin))
    return res.status(403).json({ error: 'untrusted origin' })
  const s = await session(req.headers.cookie)
  if (!s?.user) return res.status(401).json({ error: 'not signed in' })
  req.user = s.user; next()
}, express.json({ type: r => r.is('json') && !/^\/p\/[^/]+\/(raw|import)\//.test(r.path) })) // a .json uploaded is a file
app.get('/api/me', (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }))
app.get('/api/link', (req, res) => res.json({ link: link.LINK, online: link.online }))
// a join code (auth.mjs) makes whoever is signed in a member of its project
app.post('/api/join', async (req, res) => {
  let org
  try { org = joins.org(req.body?.code, req.socket.ip || req.ip) } catch (e) { return res.status(429).json({ error: e.message }) }
  if (!org) return res.status(403).json({ error: 'That code is wrong or has expired: ask for a new one.' })
  const slug = db.prepare('SELECT slug FROM organization WHERE id = ?').get(org)?.slug
  if (!access(req.user.id, slug))
    await auth.api.addMember({ body: { userId: req.user.id, organizationId: org, role: 'member' } })
  res.json({ project: slug })
})
app.get('/api/assist', assist.info)
app.get('/api/templates', templates.list)
app.use('/api', packages.router)
app.use('/api/keys', history.keys)
app.use('/api', link.bridge(PORT))
// archived: done, so out of the list and locked in the picker; any member flips it
const shelf = n => hubFile(n, 'archived')
app.get('/api/projects', (req, res) => res.json(projectsOf(req.user.id).filter(p => isProj(p.name))
  .map(({ name, role }) => ({ name, role, archived: existsSync(shelf(name)) }))))

// a new project: from a template, empty (for an archive), or a git remote
app.post('/api/projects/:name', async (req, res) => {
  const n = req.params.name, { template, brand, empty, gitUrl, branch } = req.body || {}
  if (!okName(n)) return res.status(400).json({ error: 'bad project name' })
  if (existsSync(proj(n))) return res.status(409).json({ error: 'a project with that name exists' })
  // a Typst Universe template is fetched first: one that is not there makes no project
  if (packages.SPEC.test(template)) try { await packages.template(template) }
  catch (e) { return res.status(e.status || 502).json({ error: e.message }) }
  const org = await auth.api.createOrganization({ headers: new Headers({ cookie: req.headers.cookie }),
    body: { name: n, slug: n } }).catch(e => ({ error: e?.message || 'name unavailable' }))
  if (!org || org.error) return res.status(409).json({ error: org?.error || 'name unavailable' })
  dropped.delete(n); await remote.claim(n, req.user.id)
  await ensureRepo(n)
  if (gitUrl) {
    const key = remote.sshUrl(gitUrl) ? await remote.deployKey(n) : null // kept: add it, try again
    try { await remote.adopt(n, gitUrl, branch) } catch (e) {
      await rm(proj(n), { recursive: true, force: true }); await remote.unadopt(n)
      await auth.api.deleteOrganization({ headers: new Headers({ cookie: req.headers.cookie }),
        body: { organizationId: org.id } }).catch(() => {})
      return res.status(400).json({ error: `could not adopt ${gitUrl}: ${e.message}`, key })
    }
    return res.json({ ok: true, adopted: true })
  }
  if (!empty) await templates.scaffold(n, template, brand)
  await commit(n, 'checkpoint: project created', '--allow-empty')
  res.json({ ok: true })
})

// /api/p/<project>/...: members only
const p = express.Router({ mergeParams: true })
app.use('/api/p/:proj', (req, res, next) => {
  if (!isProj(req.params.proj)) return res.status(404).json({ error: 'no such project' })
  req.org = access(req.user.id, req.params.proj)
  req.org ? next() : res.status(403).json({ error: 'you do not have access to this project' })
}, p)
for (const m of [files, build, history, remote, templates, agents, assist]) p.use(m.router)

// sharing: a verified account joins at once; any other address is invited,
// so whoever signed up as it unverified needs the invite link too
p.post('/members', admin, async (req, res) => {
  const email = String(req.body?.email || '').trim(), u = userByEmail(email)?.emailVerified && userByEmail(email)
  if (u) await auth.api.addMember({ body: { userId: u.id, organizationId: req.org.id, role: 'member' } })
  const inv = !u && await auth.api.createInvitation({ headers: new Headers({ cookie: req.headers.cookie }),
    body: { email, role: 'member', organizationId: req.org.id } })
  res.json({ ok: true, invited: !u, invite: inv?.id ?? null })
})
p.get('/join', admin, (req, res) => res.json(joins.list(req.org.id)))
p.post('/join', admin, (req, res) => res.json({ code: joins.add(req.org.id) }))
p.delete('/join/:code', admin, (req, res) => res.json({ ok: !!joins.drop(req.org.id, req.params.code) }))
// everyone reconnects and is checked again: the removed one is refused
const kick = n => { hocuspocus.closeConnections(n); build.lspOpen.get(n)?.forEach(ws => ws.close()) }
// the owner removes anyone; a member, only themself (leaving)
const self = req => db.prepare('SELECT 1 FROM member WHERE id = ? AND userId = ?').get(req.params.id, req.user.id)
p.delete('/members/:id', (req, res, next) => self(req) ? next() : admin(req, res, next), async (req, res) => {
  const headers = new Headers({ cookie: req.headers.cookie }), organizationId = req.org.id
  await (self(req) ? auth.api.leaveOrganization({ headers, body: { organizationId } })
    : auth.api.removeMember({ headers, body: { memberIdOrEmail: req.params.id, organizationId } }))
  kick(req.params.proj); res.json({ ok: true })
})
p.put('/archived', async (req, res) => {
  await mkdir(hubFile(req.params.proj, ''), { recursive: true })
  await writeFile(shelf(req.params.proj), ''); res.json({ ok: true })
})
p.delete('/archived', async (req, res) => { await rm(shelf(req.params.proj), { force: true }); res.json({ ok: true }) })
// the owner deletes it: members, files, history; a git remote is untouched
p.delete('/', admin, async (req, res) => {
  const r = await auth.api.deleteOrganization({ headers: new Headers({ cookie: req.headers.cookie }),
    body: { organizationId: req.org.id } }).catch(e => ({ error: e.message }))
  if (r?.error) return res.status(403).json(r)
  await lifecycle.dropProject(req.params.proj); res.json({ ok: true })
})
lifecycle.dropProject = async n => {
  if (!isProj(n)) return
  dropped.add(n); kick(n)
  for (const d of [proj(n), `${HUB}/${n}`]) await rm(d, { recursive: true, force: true })
}

// the built client; in development (TYDIG_DEV=1) Vite serves it, hot
const client = new URL('../client/', import.meta.url).pathname
const dev = process.env.TYDIG_DEV === '1' && await (await import('vite')).createServer({
  root: client, server: { middlewareMode: true }, appType: 'spa' })
if (dev) app.use(dev.middlewares)
else if (existsSync(`${client}dist/index.html`)) {
  // an asset's brotli copy (client/brotli.mjs), to a browser that takes it
  app.use('/assets', (req, res, next) => {
    const f = req.path.slice(1) + '.br'
    if (!/^[\w.-]+$/.test(f) || req.acceptsEncodings('br') !== 'br' || !existsSync(`${client}dist/assets/${f}`))
      return next()
    res.set({ 'Content-Encoding': 'br', Vary: 'Accept-Encoding' }).type(f.split('.').at(-2))
      .sendFile(f, { root: `${client}dist/assets`, immutable: true, maxAge: '1y' })
  })
  app.use('/assets', express.static(`${client}dist/assets`, { immutable: true, maxAge: '1y' }))
  app.use(express.static(`${client}dist`))
  app.get(/^\/(?!api\/)/, (req, res) => res.sendFile('index.html', { root: `${client}dist` }))
}

app.use((e, req, res, next) => {
  if (res.headersSent) return next(e)
  const code = [e.statusCode, e.status].find(Number.isInteger) ?? 500
  if (code >= 500) console.error(e)
  res.status(code).json({ error: code < 500 ? e.message : 'internal error' })
})

// websockets: /sync (the CRDT) and /lsp, signed in and a member
const sync = new WebSocketServer({ noServer: true })
hocuspocus.configure({
  async onAuthenticate({ token, requestHeaders: h, requestParameters: q, documentName: n }) {
    const s = isProj(n) && originOk(h?.origin) && await session(h?.cookie, token)
    if (!s?.user || !access(s.user.id, n)) throw new Error('forbidden')
    // an offline copy of another lineage (store.mjs): the browser starts again (doc.js)
    if (q.get('epoch') && q.get('epoch') !== await epoch(n)) throw Object.assign(new Error('epoch'), { reason: 'epoch' })
    return { user: { id: s.user.id, name: s.user.name, email: s.user.email } }
  },
  onChange: ({ documentName: n, context: c }) => edited(n, c.user),
})
const server = app.listen(PORT, () => {
  console.log(`tydig on :${PORT}, data in ${DATA}; open ${TRUSTED[0]}`)
  link.start(server).catch(e => console.warn('link:', e.message))
  remote.start()
})
server.on('upgrade', async (req, sock, head) => {
  sock.on('error', () => {})
  const u = new URL(req.url, 'http://x')
  if (/^\/sync(\/|$)/.test(u.pathname)) return sync.handleUpgrade(req, sock, head, ws => hocuspocus.handleConnection(ws, req))
  const n = u.searchParams.get('proj')
  if (u.pathname !== '/lsp' || !isProj(n) || !originOk(req.headers.origin)) return sock.destroy()
  const s = await session(req.headers.cookie, u.searchParams.get('t'))
  if (!s?.user || !access(s.user.id, n)) return sock.destroy()
  build.lsp(req, sock, head, n, s.user.id)
})

// leaving saves every open project and pushes it: the hub is disposable
process.on('unhandledRejection', e => console.error('unhandled:', e))
let leaving = false
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  if (leaving) process.exit(1)
  leaving = true
  for (const [n, doc] of hocuspocus.documents) await save(n, doc, true).catch(e => console.warn(`save ${n}: ${e.message}`))
  await remote.syncAll('shutdown')
  process.exit(0)
})
