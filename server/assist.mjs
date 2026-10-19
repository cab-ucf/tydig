// The hub's models, for every member: ghost text (an Ollama model,
// TYDIG_OLLAMA + TYDIG_GHOST_MODEL) and the surprise overlay (a
// Perplexiscope engine, TYDIG_PERPLEXISCOPE). Fixed requests only, one at a
// time per person: a newer ask replaces theirs.
import express from 'express'
import { WebSocket } from 'ws'

const OLLAMA = process.env.TYDIG_OLLAMA?.replace(/\/$/, ''), GHOST = process.env.TYDIG_GHOST_MODEL
const SCOPE = process.env.TYDIG_PERPLEXISCOPE?.replace(/\/$/, '')
const asking = new Map() // user + what -> AbortController
const ask = (req, what) => {
  const k = req.user.id + what, a = new AbortController()
  asking.get(k)?.abort(); asking.set(k, a)
  return [a.signal, () => asking.get(k) === a && asking.delete(k)]
}
const fail = (res, e, what) => res.status(e.status || (e.name === 'AbortError' ? 409 : 502)).json({
  error: e.status || e.name === 'AbortError' ? e.message : `the hub's ${what} is not answering (${e.cause?.code || e.code || e.message})` })
const pick = (j, ks) => Object.fromEntries(ks.map(k => [k, j[k]]))

export const info = (req, res) => res.json({ ghost: OLLAMA && GHOST ? GHOST : null, surprise: !!SCOPE })
export const router = express.Router({ mergeParams: true })

// a line's continuation: fill-in-the-middle when given a suffix, else raw
router.post('/ghost', async (req, res) => {
  const { prompt, suffix } = req.body || {}
  if (!OLLAMA || !GHOST) return res.status(404).json({ error: 'this hub serves no ghost model' })
  if (typeof prompt !== 'string' || prompt.length > 4000 || (suffix != null && (typeof suffix !== 'string' || suffix.length > 2000)))
    return res.status(400).json({ error: 'a prompt of at most 4000 characters' })
  const [signal, done] = ask(req, 'ghost')
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', signal, body: JSON.stringify({
      model: GHOST, prompt, ...suffix != null ? { suffix } : { raw: true }, think: false, stream: false,
      keep_alive: '30m', options: { temperature: 0.2, num_predict: 40, stop: ['\n'] } }) })
    const j = await r.json().catch(() => ({}))
    res.status(r.status).json(r.ok ? { response: j.response } : { error: j.error || `the model answered ${r.status}` })
  } catch (e) { fail(res, e, 'model') } finally { done() }
})

// the words' scores; ?ai: the detector's reading instead (slower), null without
// one, each sentence with where it is (s, e: characters of the text); ?report:
// a whole-document check, asked apart from the overlay's, so neither replaces the other
router.post('/surprise', express.text({ limit: '1mb' }), async (req, res) => {
  if (!SCOPE) return res.status(404).json({ error: 'this hub serves no surprise engine' })
  if (typeof req.body !== 'string') return res.status(400).json({ error: 'the text, as text/plain' })
  const ai = 'ai' in req.query, [signal, done] = ask(req, 'report' in req.query ? 'report' : 'surprise')
  const ws = new WebSocket(SCOPE.replace(/^http/, 'ws') + '/ws'), secs = ai ? 180 : 60
  let timer
  try {
    res.json(await new Promise((ok, no) => {
      const err = (m, status) => no(Object.assign(new Error(m), { status }))
      signal.onabort = () => err('replaced by a newer ask', 409)
      timer = setTimeout(() => no(new Error(`no answer in ${secs} s`)), secs * 1000)
      let detector, at
      ws.on('open', () => ws.send(JSON.stringify({ seq: 1, text: req.body, cursor: null, k: 3, depth: 3, m: 'none', a: 0, T: 1, ai })))
      ws.on('error', no).on('close', () => no(new Error('it hung up'))).on('message', m => {
        let j
        try { j = JSON.parse(m) } catch { return no(new Error('it answered nonsense')) }
        if (j.type === 'hello') detector = j.detector
        else if (j.type === 'error') err(j.message, 422)
        else if (j.type === 'heat' && !ai) ok(pick(j, ['words', 'sents', 'ppl', 'bpt', 'ntok']))
        else if (j.type === 'heat' && (!detector || !j.sents.length)) ok({ ai: null })
        else if (j.type === 'heat') at = j.sents
        else if (j.type === 'ai') ok({ ai: j.sents ? { ...pick(j, ['score', 'tail', 'words', 'calibrated', 'family', 'task']),
          sents: j.sents.map((x, i) => ({ ...x, s: at?.[i]?.s, e: at?.[i]?.e })) } : null })
      })
    }))
  } catch (e) { fail(res, e, 'surprise engine') } finally { clearTimeout(timer); ws.terminate(); done() }
})
