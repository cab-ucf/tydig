// Shared by every suite: a hub at HUB, people signing up, live documents.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
export { Y }

export const HUB = process.env.HUB || 'http://localhost:3000'
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const until = async (f, ms = 30_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(300)) if (await f().catch(() => false)) return true
  return false
}
let pass = true
export const check = (name, ok) => { console.log(ok ? 'PASS' : 'FAIL', name); pass &&= !!ok }
export const done = () => { console.log(pass ? 'ALL PASS' : 'FAILURES'); process.exit(pass ? 0 : 1) }

// a person: fetch as them (res), JSON (get, post, put, del), and a live doc
export async function person(name, { hub = HUB, invite, email } = {}) {
  email ??= `${name.toLowerCase()}${Date.now()}${Math.random().toString(36).slice(2, 6)}@t.co`
  const r = await fetch(`${hub}/api/auth/sign-up/email`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: hub, ...invite && { 'x-tydig-invite': invite } },
    body: JSON.stringify({ email, password: 'password123', name }) })
  const cookie = r.headers.getSetCookie()[0]?.split(';')[0] || ''
  const token = /session_token=([^;]+)/.exec(cookie)?.[1]
  const res = (p, o = {}) => fetch(hub + '/api' + p, { ...o, headers: { cookie, origin: hub, ...o.headers } })
  const json = (method, p, body) => res(p, { method, ...body !== undefined && {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } }).then(r => r.json())
  return { email, cookie, token, ok: r.ok, status: r.status, signup: r, res,
    get: p => json('GET', p), post: (p, b = {}) => json('POST', p, b), put: (p, b) => json('PUT', p, b),
    del: p => json('DELETE', p), doc: (proj, o) => doc(hub, proj, token, o) }
}
// sharing with an account here: an invitation it accepts, as its address
// is not verified (password accounts never are)
export async function share(proj, from, to) {
  const { invite } = await from.post(`/p/${proj}/members`, { email: to.email })
  return to.post('/auth/organization/accept-invitation', { invitationId: invite })
}
// a live document, synced; .files is its 'files' map
export function doc(hub, name, token, o = {}) {
  const d = new Y.Doc()
  d.provider = new HocuspocusProvider({ url: hub.replace(/^http/, 'ws') + '/sync', name, document: d,
    token, WebSocketPolyfill: WebSocket, ...o })
  d.files = d.getMap('files')
  return d
}
