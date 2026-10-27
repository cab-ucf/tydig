// The Discussion mirrored with an irch channel: another irch node (`ira`)
// makes a space and #paper, ann links the project with its invite, and
// messages cross both ways. The hub runs with TYDIG_IRCH (run.mjs).
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { person, share, check, done, sleep, until } from './lib.mjs'

const ira = spawn(process.env.TYDIG_IRCH, ['--api', '--name', 'Ira',
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
check('the hub runs irch', (await ann.get('/p/paper/irch')).on)

const space = await call('create', { name: 'Lab' }), channel = 'a1b2c3d4e5f60718'
await call('publish', { space, op: { Channel: { id: channel, name: 'paper' } } })
const code = await call('invite', { space })
check('a member cannot link it', (await bob.post('/p/paper/irch', { code })).error)
const k = await ann.post('/p/paper/irch', { code })
check('the owner links it, to #paper', k.where === '#paper in Lab' && k.channel === channel)

const said = () => call('messages', { space, channel, before: null, limit: 50 })
const doc = ann.doc('paper'), chat = doc.getArray('chat')
await until(async () => doc.files.size)
chat.push([{ id: 'm1', author: 'Ann', text: 'plots are in', ts: Date.now() }])
check('the Discussion reaches irch, as its author', await until(async () =>
  (await said()).some(m => m.text === '**Ann**: plots are in')))
await call('publish', { space, op: { Post: { channel, text: 'nice, @claude check fig 2', reply: null, files: [] } } })
check('irch reaches the Discussion, once, as its author', await until(async () =>
  chat.toArray().filter(m => m.irch && m.author === 'Ira' && m.text === 'nice, @claude check fig 2').length === 1))
await sleep(1500)
check('and nothing echoes, either way', (await said()).length === 2 && chat.length === 2)

await ann.del('/p/paper/irch')
check('unlinked, the Discussion stays here', !(await ann.get('/p/paper/irch')).where)
ira.kill(); done()
