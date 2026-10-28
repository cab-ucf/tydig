// The Discussion, mirrored with a channel of an irch space
// (github.com/cab-ucf/irch): the hub runs `irch --api` (TYDIG_IRCH, its
// path) as one more member of that space.
import express from 'express'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { HUB, hubFile, isProj, live, opened } from './store.mjs'
import { admin } from './auth.mjs'

// project -> { space, channel, where, since }
const file = n => hubFile(n, 'irch.json')
const links = new Map(readdirSync(HUB).filter(n => isProj(n) && existsSync(file(n)))
  .map(n => [n, JSON.parse(readFileSync(file(n), 'utf8'))]))

let me = null, seq = 0
const wait = new Map(), warn = e => console.warn('irch:', e.message)
const irch = process.env.TYDIG_IRCH && spawn(process.env.TYDIG_IRCH,
  ['--api', '--dir', path.join(HUB, '.irch'), '--name', 'tydig'], { stdio: ['pipe', 'pipe', 'inherit'] })
const down = e => { me = null; wait.forEach(([, no]) => no(e)); wait.clear() }
const call = (cmd, a) => new Promise((ok, no) => {
  if (!irch?.pid || irch.exitCode != null) return no(new Error('no irch on this hub (TYDIG_IRCH)'))
  wait.set(++seq, [ok, no]); irch.stdin.write(JSON.stringify({ id: seq, cmd, ...a }) + '\n')
})
if (irch) {
  irch.on('error', e => (warn(e), down(e))).on('exit', () => down(new Error('irch stopped')))
  irch.stdin.on('error', () => {})
  createInterface({ input: irch.stdout }).on('line', l => {
    let m; try { m = JSON.parse(l) } catch { return }
    const [ok, no] = wait.get(m.id) || []
    if (m.event?.t === 'changed') for (const [n, k] of links) k.space === m.event.space && pull(n)
    wait.delete(m.id); 'err' in m ? no?.(new Error(m.err)) : ok?.(m.ok)
  })
  call('me').then(r => { me = r.id; links.forEach((_, n) => pull(n)) }, () => {})
}

// irch to the Discussion: what is not there yet, since the link
const hue = id => `hsl(${parseInt(id.slice(0, 4), 16) % 360} 60% 55%)`
const soon = new Map()
const pull = n => soon.has(n) || soon.set(n, setTimeout(() => { soon.delete(n); bring(n).catch(warn) }, 300))
async function bring(n) {
  const k = links.get(n)
  if (!k || !me) return
  const ms = (await call('messages', { space: k.space, channel: k.channel, before: null, limit: 100 }))
    .filter(m => m.author !== me && m.ts >= k.since && m.text)
  if (ms.length) await live(n, doc => {
    const chat = doc.getArray('chat'), have = new Set(chat.toArray().map(m => m.irch))
    const add = ms.filter(m => !have.has(m.id)).map(m => ({ id: m.id.slice(0, 16), author: m.name,
      color: hue(m.author), text: [m.text, ...m.files.map(f => `📎 ${f.name}`)].join('\n'), ts: m.ts, irch: m.id }))
    add.length && chat.push(add)
  })
}

// the Discussion to irch: each new message, as its author's
const seen = new WeakSet()
opened.add((n, doc) => seen.has(doc) || seen.add(doc) && doc.getArray('chat').observe(e => {
  const k = links.get(n)
  if (k && me) for (const m of e.changes.delta.flatMap(d => d.insert || []))
    if (!m.irch && !m.re) call('publish', { space: k.space, op: { Post: { channel: k.channel,
      text: `**${m.author}**: ${m.text}`, reply: null, files: [] } } }).catch(warn)
}))

export const router = express.Router({ mergeParams: true })
router.get('/irch', (req, res) => res.json({ on: !!me, ...links.get(req.params.proj) }))
// an invite code from irch: the hub joins, and mirrors its #<project>
// channel (made if the hub may), else its first
router.post('/irch', admin, async (req, res) => {
  const n = req.params.proj
  try {
    const space = await call('join', { code: String(req.body?.code || '').trim() })
    let s // its channels arrive with the first sync
    for (let i = 0; i < 60 && !s?.channels.length; i++, await sleep(250))
      s = (await call('spaces')).find(s => s.id === space)
    if (!s?.channels.length) throw new Error('no peer of that space answered yet: try again in a moment')
    let c = s.channels.find(c => c.name === n)
    if (!c && s.admin) {
      c = { id: randomBytes(8).toString('hex'), name: n }
      await call('publish', { space, op: { Channel: { id: c.id, name: n } } })
    }
    c ||= s.channels[0]
    const k = { space, channel: c.id, where: `#${c.name} in ${s.name}`, since: Date.now() }
    mkdirSync(path.dirname(file(n)), { recursive: true })
    writeFileSync(file(n), JSON.stringify(k), { mode: 0o600 })
    links.set(n, k); res.json(k)
  } catch (e) { res.status(400).json({ error: e.message }) }
})
router.delete('/irch', admin, (req, res) => {
  links.delete(req.params.proj); rmSync(file(req.params.proj), { force: true }); res.json({ ok: true })
})
