// irch, linked, never mirrored: a project names its irch channel (a link),
// and ann's @mentions reach a space of hers in her irch (`ira`, another irch
// node). Nothing else crosses. The hub runs with TYDIG_IRCH (run.mjs).
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { person, share, check, done, sleep, until } from './lib.mjs'

const ira = spawn(process.env.TYDIG_IRCH, ['--api', '--name', 'Ann',
  '--dir', mkdtempSync(path.join(tmpdir(), 'ira-'))], { stdio: ['pipe', 'pipe', 'inherit'] })
const wait = new Map()
createInterface({ input: ira.stdout }).on('line', l => {
  const m = JSON.parse(l)
  wait.get(m.id)?.(m); wait.delete(m.id)
})
let n = 0
const call = (cmd, a) => new Promise((ok, no) => {
  wait.set(++n, m => 'err' in m ? no(new Error(m.err)) : ok(m.ok))
  ira.stdin.write(JSON.stringify({ id: n, cmd, ...a }) + '\n')
})

const ann = await person('Ann'), bob = await person('Bob')
await ann.post('/projects/paper'); await share('paper', ann, bob)

// a link, only
const link = `irch://open/${'a'.repeat(64)}/${'b'.repeat(16)}`
const put = (who, l) => who.put('/p/paper/irch', { link: l })
check('a member cannot name the channel', (await put(bob, link)).error)
check('nor anything but a channel link', (await put(ann, 'https://evil.example')).error)
check('the owner names it, and members see it', (await put(ann, link)).link === link &&
  (await bob.get('/p/paper/irch')).link === link)

// ann's mentions, in a space of hers
check('the hub runs irch', await until(async () => (await ann.get('/irch-notify')).on))
const space = await call('create', { name: 'Ann alone' }), code = await call('invite', { space })
const ch = (await call('spaces')).find(s => s.id === space).channels[0].id
const r = await ann.post('/irch-notify', { code })
check('ann asks to be told there', r.where === '#general in Ann alone' && (await ann.get('/irch-notify')).where)
const told = async () => (await call('messages', { space, channel: ch, before: null, limit: 50 })).map(m => m.text)
check('the hub says hello there', await until(async () => (await told()).some(t => t.includes('@mentions you'))))

const doc = bob.doc('paper'), chat = doc.getArray('chat')
await until(async () => doc.files.size)
chat.push([{ id: 'm1', author: 'Bob', text: 'plots are in, no one named', ts: Date.now() }])
chat.push([{ id: 'm2', author: 'Bob', text: '@ann can you check fig 2?', ts: Date.now() }])
doc.getMap('comments').set('c1', { file: 'main.typ', author: 'Bob', text: '@Ann cite this', ts: Date.now() })
check('her mentions reach her irch: who, where, what, the link', await until(async () => {
  const t = await told()
  return t.some(x => x.startsWith('**Bob** mentioned you in the Discussion in **paper**: @ann can you check fig 2?') &&
    x.includes('/?proj=paper')) && t.some(x => x.includes('mentioned you on main.typ') && x.includes('@Ann cite this'))
}))
await sleep(1500)
check('and nothing else: no other message, no mirror', (await told()).length === 3 &&
  !chat.toArray().some(m => m.irch))

await ann.del('/irch-notify')
chat.push([{ id: 'm3', author: 'Bob', text: '@Ann once more', ts: Date.now() }])
await sleep(2000)
check('stopped, she is told no more', !(await ann.get('/irch-notify')).where &&
  !(await told()).some(t => t.includes('once more')))
ira.kill(); done()
