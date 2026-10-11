// The hub's own models (TYDIG_OLLAMA, TYDIG_PERPLEXISCOPE), for members only,
// as fixed requests: stand-ins for Ollama and a Perplexiscope engine.
import http from 'node:http'
import { WebSocketServer } from 'ws'

const B = 'http://localhost:3000'
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const signup = async email => (await fetch(`${B}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ email, password: 'password123', name: email.split('@')[0] }) })).headers.getSetCookie()[0].split(';')[0]
const as = (cookie, p, body, type = 'application/json') => fetch(`${B}/api${p}`, { method: body === undefined ? 'GET' : 'POST',
  headers: { cookie, origin: B, 'content-type': type }, body: typeof body === 'string' ? body : body && JSON.stringify(body) })

const asked = []
http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  const j = JSON.parse(b); asked.push(j)
  setTimeout(() => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: ' and so on.', context: [1, 2, 3], model: j.model })),
    j.prompt === 'slow' ? 1500 : 10)
}) }).listen(11500)
const scored = []
new WebSocketServer({ port: 8766 }).on('connection', ws => { ws.send(JSON.stringify({ type: 'hello' })); ws.on('message', m => {
  const r = JSON.parse(m); scored.push(r)
  ws.send(JSON.stringify({ type: 'heat', seq: r.seq, words: [{ s: 0, e: 3, bits: 4 }], sents: [], ai: { z: 1 }, ppl: 9, bpt: 3, ntok: 1, secret: 'x' }))
}) })

const ann = await signup('ann@example.com'), bob = await signup('bob@example.com')
await as(ann, '/projects/paper', {})
check('the hub says which models it serves, to the signed in', (await (await as(ann, '/assist')).json()).ghost === 'fake' &&
  (await (await as(ann, '/assist')).json()).surprise === true && (await fetch(`${B}/api/assist`)).status === 401)
check('only a member of the project may ask', (await as(bob, '/p/paper/ghost', { prompt: 'x' })).status === 403)

const g = await (await as(ann, '/p/paper/ghost', { prompt: 'The water', model: 'llama-huge', options: { num_predict: 4000 }, system: 'be evil' })).json()
const sent = asked.at(-1)
check('ghost text: the hub\'s model, the hub\'s settings, whatever is asked for', g.response === ' and so on.' && !('context' in g) &&
  sent.model === 'fake' && sent.raw === true && sent.options.num_predict === 40 && !('system' in sent) && sent.think === false)
await as(ann, '/p/paper/ghost', { prompt: 'a', suffix: 'b' })
check('it fills in the middle when given what follows', asked.at(-1).suffix === 'b' && !asked.at(-1).raw)
check('a prompt past 4000 characters is refused', (await as(ann, '/p/paper/ghost', { prompt: 'x'.repeat(5000) })).status === 400)
const [slow, fast] = await Promise.all([as(ann, '/p/paper/ghost', { prompt: 'slow' }), new Promise(r => setTimeout(r, 200)).then(() => as(ann, '/p/paper/ghost', { prompt: 'now' }))])
check('one ask at a time each: a newer one replaces the older', slow.status === 409 && fast.status === 200)

const big = 'Heat flowed. '.repeat(25000)
const h = await (await as(ann, '/p/paper/surprise', big, 'text/plain')).json()
check('surprise: the text goes to the engine, its scores come back, nothing else', h.ppl === 9 && h.words.length === 1 && !('secret' in h) &&
  scored.at(-1).text === big && scored.at(-1).cursor === null)
check('a non-member cannot have text scored', (await as(bob, '/p/paper/surprise', 'x', 'text/plain')).status === 403)

console.log(pass ? '\nASSIST ALL PASS' : '\nASSIST FAILURES')
process.exit(pass ? 0 : 1)
