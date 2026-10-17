// The hub's own models (TYDIG_OLLAMA, TYDIG_PERPLEXISCOPE), for members only,
// as fixed requests: stand-ins for Ollama and a Perplexiscope engine.
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { HUB, person, check, done } from './lib.mjs'

const as = (who, p, body, type = 'application/json') => who.res(p, { method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': type }, body: typeof body === 'string' ? body : body && JSON.stringify(body) })

const asked = []
http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  const j = JSON.parse(b); asked.push(j)
  setTimeout(() => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: ' and so on.', context: [1, 2, 3], model: j.model })),
    j.prompt === 'slow' ? 1500 : 10)
}) }).listen(11500)
const scored = []
new WebSocketServer({ port: 8766 }).on('connection', ws => { ws.send(JSON.stringify({ type: 'hello', detector: 'meld' })); ws.on('message', m => {
  const r = JSON.parse(m); scored.push(r)
  if (r.text === 'too long') return ws.send(JSON.stringify({ type: 'error', message: 'Text is over 100,000 characters; shorten it to score it.' }))
  ws.send(JSON.stringify({ type: 'heat', seq: r.seq, words: [{ s: 0, e: 3, bits: 4 }], sents: [{ s: 0, e: 3, w: 1, bits: 4 }], ppl: 9, bpt: 3, ntok: 1, secret: 'x' }))
  ws.send(JSON.stringify({ type: 'ai', seq: r.seq, score: 2, tail: 0.004, words: 120, calibrated: false, family: 'gpt', task: 'write', sents: [{ score: 2, tail: 0.004 }], secret: 'x' }))
}) })

const ann = await person('Ann'), bob = await person('Bob')
await as(ann, '/projects/paper', {})
check('the hub says which models it serves, to the signed in', (await (await as(ann, '/assist')).json()).ghost === 'fake' &&
  (await (await as(ann, '/assist')).json()).surprise === true && (await fetch(`${HUB}/api/assist`)).status === 401)
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
const a = await (await as(ann, '/p/paper/surprise?ai', big, 'text/plain')).json()
check('and with ?ai, the detector\'s reading of it, per sentence and whole', a.ai.tail === 0.004 && a.ai.sents[0].tail === 0.004 &&
  'e' in a.ai.sents[0] &&
  a.ai.family === 'gpt' && !('secret' in a.ai) && Object.keys(a).join() === 'ai')
const long = await as(ann, '/p/paper/surprise', 'too long', 'text/plain')
check('what the engine refuses, it says why', long.status === 422 && /100,000 characters/.test((await long.json()).error))
check('a non-member cannot have text scored', (await as(bob, '/p/paper/surprise', 'x', 'text/plain')).status === 403)
done()
