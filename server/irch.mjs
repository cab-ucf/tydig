// irch (github.com/cab-ucf/irch), linked, never mirrored: each keeps its own
// members and keys. A project names the irch channel it is discussed in (a
// link each person's irch opens), and whoever asks hears of their @mentions
// in an irch space of their own, through `irch --api` (TYDIG_IRCH).
import express from 'express'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { HUB, hubFile, opened } from './store.mjs'
import { admin, db, TRUSTED } from './auth.mjs'

const read = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
const write = (f, v) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(v), { mode: 0o600 })
}

// ---- a project's channel: only a link ----
const LINK = /^irch:\/\/open\/[0-9a-f]{64}\/[0-9a-f]{16}$/
const linkOf = n => hubFile(n, 'irch.json')
export const router = express.Router({ mergeParams: true })
router.get('/irch', (req, res) => res.json({ link: read(linkOf(req.params.proj))?.link ?? null }))
router.put('/irch', admin, (req, res) => {
  const link = String(req.body?.link || '').trim()
  if (link && !LINK.test(link)) return res.status(400).json({ error: "a channel's link, from irch: Copy Link" })
  link ? write(linkOf(req.params.proj), { link }) : rmSync(linkOf(req.params.proj), { force: true })
  res.json({ link: link || null })
})

// ---- the hub's irch, which tells people of their mentions ----
let up = false, seq = 0
const wait = new Map(), warn = e => console.warn('irch:', e.message)
const irch = process.env.TYDIG_IRCH && spawn(process.env.TYDIG_IRCH,
  ['--api', '--dir', path.join(HUB, '.irch'), '--name', 'tydig'], { stdio: ['pipe', 'pipe', 'inherit'] })
const call = (cmd, a) => new Promise((ok, no) => {
  if (!irch?.pid || irch.exitCode != null) return no(new Error('no irch on this hub (TYDIG_IRCH)'))
  wait.set(++seq, [ok, no]); irch.stdin.write(JSON.stringify({ id: seq, cmd, ...a }) + '\n')
})
if (irch) {
  const down = e => { up = false; wait.forEach(([, no]) => no(e)); wait.clear() }
  irch.on('error', e => (warn(e), down(e))).on('exit', () => down(new Error('irch stopped')))
  irch.stdin.on('error', () => {})
  createInterface({ input: irch.stdout }).on('line', l => {
    let m; try { m = JSON.parse(l) } catch { return }
    const [ok, no] = wait.get(m.id) || []
    wait.delete(m.id); 'err' in m ? no?.(new Error(m.err)) : ok?.(m.ok)
  })
  call('me').then(() => up = true, warn)
}

// person -> { space, channel, where }: a space of theirs, which the hub joined
const PEOPLE = path.join(HUB, '.irch-people.json')
const people = read(PEOPLE) || {}
export const notify = express.Router()
notify.get('/', (req, res) => res.json({ on: up, where: people[req.user.id]?.where ?? null }))
notify.post('/', async (req, res) => {
  try {
    const space = await call('join', { code: String(req.body?.code || '').trim() })
    let s // its channels arrive with the first sync
    for (let i = 0; i < 60 && !s?.channels.length; i++, await sleep(250))
      s = (await call('spaces')).find(s => s.id === space)
    if (!s?.channels.length) throw new Error('no device of that space answered yet: try again in a moment')
    people[req.user.id] = { space, channel: s.channels[0].id, where: `#${s.channels[0].name} in ${s.name}` }
    write(PEOPLE, people)
    await say(people[req.user.id], 'tydig tells you here when someone @mentions you.')
    res.json({ where: people[req.user.id].where })
  } catch (e) { res.status(400).json({ error: e.message }) }
})
notify.delete('/', async (req, res) => {
  const p = people[req.user.id]
  delete people[req.user.id]; write(PEOPLE, people)
  if (p && !Object.values(people).some(q => q.space === p.space)) await call('leave', { space: p.space }).catch(warn)
  res.json({ ok: true })
})

const say = (p, text) => call('publish', { space: p.space, op: { Post: { channel: p.channel, text, reply: null, files: [] } } })
// @ and the first name, as the editor reads it (client/src/comments.js)
const nick = name => name.split(/[\s@]/)[0].replace(/[^\p{L}\p{N}_]/gu, '')
const named = (name, text) => {
  const n = nick(name)
  return !!n && new RegExp(`@${n}(?![\\p{L}\\p{N}_])`, 'iu').test(text)
}
const members = db.prepare('SELECT u.id, u.name FROM member m JOIN user u ON u.id = m.userId ' +
  'JOIN organization o ON o.id = m.organizationId WHERE o.slug = ?')
const URL_ = (process.env.TYDIG_URL || TRUSTED[0]).replace(/\/$/, '')
const plain = s => String(s).replace(/\s+/g, ' ').trim()
function mentioned(n, x, where) {
  if (!up || typeof x?.text !== 'string') return
  for (const m of members.all(n)) {
    const p = people[m.id]
    if (!p || m.name === x.author || !named(m.name, x.text)) continue
    const text = plain(x.text), cut = text.length > 200 ? text.slice(0, 200) + '…' : text
    say(p, `**${plain(x.author)}** mentioned you ${where} in **${n}**: ${cut}\n${URL_}/?proj=${n}`).catch(warn)
  }
}
const seen = new WeakSet()
opened.add((n, doc) => {
  if (seen.has(doc)) return
  seen.add(doc)
  doc.getArray('chat').observe(e => {
    for (const x of e.changes.delta.flatMap(d => d.insert || []))
      mentioned(n, x, x.re ? 'replying to a comment' : 'in the Discussion')
  })
  const cs = doc.getMap('comments')
  cs.observe(e => {
    for (const [k, c] of e.changes.keys)
      if (c.action === 'add') mentioned(n, cs.get(k), `on ${cs.get(k)?.file}`)
  })
})
