// Browser-level test: drives the built client in headless Chrome. This is the
// suite that catches what the API suites cannot -- panes that render into a
// hidden element, preview compiles that fail on missing files, UI labels.
// `just test ui` installs puppeteer into .uitest/, apart from the app's own.
import { createRequire } from 'node:module'
import path from 'node:path'
const puppeteer = (await import(createRequire(new URL('../.uitest/package.json', import.meta.url))
  .resolve('puppeteer'))).default
let pass = true
const check = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); pass &&= cond }
const { person } = await import('./lib.mjs')
const B = process.env.HUB || 'http://localhost:3000'
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errors = []
page.on('pageerror', e => errors.push('[pageerror] ' + e.message))
page.on('error', e => errors.push('[CRASH] ' + e.message))
// the stand-in Ollama below refuses on purpose
const ours = s => /:11434\//.test(s)
page.on('console', m => { if (m.type() === 'error' && !ours(m.text() + m.location()?.url)) errors.push('[console] ' + m.text()) })
page.on('response', r => { if (r.status() >= 400 && !ours(r.url())) errors.push(`[http ${r.status()}] ${r.url()}`) })
const external = []
// the local model (ghost suggestions) is this machine, asked for by the person
page.on('request', r => { if (!/^(data|blob):/.test(r.url()) && ![new URL(B).origin, 'http://localhost:11434'].includes(new URL(r.url()).origin)) external.push(r.url()) })
let answer = null
page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept(answer ?? (d.defaultValue() || 'first signed checkpoint')); else if (d.type() === 'confirm' && yes) await d.accept(); else await d.dismiss() })
let yes = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
const side = () => page.evaluate(() => ({ hidden: document.getElementById('side').hidden,
  title: (document.querySelector('#side-tabs .on')?.firstChild.textContent || document.getElementById('side-title').textContent).toLowerCase(), body: document.getElementById('side-body').innerText.slice(0, 300) }))

await page.goto(B, { waitUntil: 'networkidle2', timeout: 60000 })
await page.waitForSelector('#auth-form'); await page.click('.auth-tabs button[data-tab="up"]')
await page.type('input[name=name]', 'Ada'); await page.type('input[name=email]', `ada${Date.now()}@example.com`); await page.type('input[name=password]', 'password123')
await page.click('.auth-submit'); await sleep(2000)
await page.evaluate(async () => (await fetch('/api/projects/demo', { method: 'POST' })).json())
await page.goto(`${B}/?proj=demo`, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(12000)
const pv = await page.evaluate(() => ({ diagHidden: document.getElementById('diag').hidden, svg: document.querySelectorAll('#page svg use, #page svg path').length > 0, diag: document.getElementById('diag').textContent.slice(0, 200) }))
check('preview compiled on a fresh project (no missing files)', pv.diagHidden && pv.svg)
if (!pv.diagHidden) console.log('  diag:', pv.diag)

// 0. Comment straight from the preview: select rendered text, click the
//    button that appears. "decision rule" occurs twice; take the second.
await page.evaluate(() => {
  const nodes = [], w = document.createTreeWalker(document.getElementById('page'), NodeFilter.SHOW_TEXT); let n, all = ''
  while ((n = w.nextNode())) if (n.parentElement.closest('.tsel')) { nodes.push([n, all.length]); all += n.textContent }
  const i = all.indexOf('decision rule', all.indexOf('decision rule') + 1), at = o => { const [nd, s] = nodes.findLast(([, s]) => s <= o); return [nd, o - s] }
  const r = document.createRange(); r.setStart(...at(i)); r.setEnd(...at(i + 13))
  getSelection().removeAllRanges(); getSelection().addRange(r); document.dispatchEvent(new MouseEvent('mouseup'))
})
await sleep(200)
const pvBtn = await page.evaluate(() => !document.getElementById('pv-comment').hidden)
if (pvBtn) await page.click('#pv-comment')
await sleep(800)
const pvAnchor = await page.evaluate(() => {
  const lines = [...document.querySelectorAll('.cm-line')], i = lines.findIndex(l => l.querySelector('.cm-comment-anchor'))
  return { line: i + 1, text: lines[i]?.querySelector('.cm-comment-anchor').textContent }
})
check('comment from a preview selection lands on the right source text', pvBtn && pvAnchor.text === 'decision rule' && pvAnchor.line === 23)
await page.hover('.cm-comment-anchor'); await sleep(900)
check('hovering commented text shows the comment', !!(await page.$eval('.cm-comment-tip', e => e.textContent).catch(() => '')))

// Uploads: into figures/ (the prompt's default), which opens to show them.
// The .dat has no MIME type, so the browser sends no Content-Type.
const { writeFileSync } = await import('node:fs'), tmp = (await import('node:os')).tmpdir()
writeFileSync(`${tmp}/ui-logo.png`, Buffer.from('89504e470d0a1a0a', 'hex')); writeFileSync(`${tmp}/ui-raw.dat`, 'raw')
const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#upload')])
await chooser.accept([`${tmp}/ui-logo.png`, `${tmp}/ui-raw.dat`]); await sleep(2000)
const shown = await page.evaluate(() => [...document.querySelectorAll('#tree .tnode')].map(e => e.title))
check('uploads land in the chosen folder and show in the tree', ['figures/ui-logo.png', 'figures/ui-raw.dat'].every(p => shown.includes(p)))
// an archive uploaded is unpacked (when asked), out of the folder it came in
const { execFileSync } = await import('node:child_process'), { mkdirSync } = await import('node:fs')
mkdirSync(`${tmp}/ui-pkg/pkg`, { recursive: true }); writeFileSync(`${tmp}/ui-pkg/pkg/notes.typ`, '= Notes\n')
execFileSync('tar', ['-czf', `${tmp}/ui-pkg.tar.gz`, '-C', `${tmp}/ui-pkg`, 'pkg'])
yes = true
const [ch2] = await Promise.all([page.waitForFileChooser(), page.click('#upload')])
await ch2.accept([`${tmp}/ui-pkg.tar.gz`]); await sleep(2500); yes = false
check('an uploaded .tar.gz unpacks into the project, and says what it added', await page.evaluate(() =>
  [...document.querySelectorAll('#tree .tnode')].some(e => e.title === 'figures/notes.typ') && /1 added/.test(document.getElementById('toast')?.textContent)))

// Ctrl-click picks several files; one x deletes them all
const row = p => `#tree .tnode[title="${p}"]`
await page.keyboard.down('Control')
for (const p of ['figures/ui-logo.png', 'figures/ui-raw.dat']) await page.click(row(p) + ' .fname')
await page.keyboard.up('Control'); yes = true
await page.$eval(row('figures/ui-raw.dat') + ' .del', b => b.click()); await sleep(1500)
check('ctrl-click several files, delete them at once', await page.evaluate(() =>
  !document.querySelector('#tree .tnode[title^="figures/ui-"]')))
yes = false

// 1. Comments pane via the View menu action
await page.evaluate(() => document.querySelector('[data-action="comments"], button[data-act="comments"]')?.click())
await sleep(500); const s = await side()
check('comments pane opens', !s.hidden && s.title === 'comments')
check('the panel has tabs for comments, the Discussion, history and build', await page.evaluate(() =>
  [...document.querySelectorAll('#side-tabs button')].map(b => b.firstChild.textContent).join() === 'Comments,Discussion,History,Build'))
// Ctrl-K finds any command by name
await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(300)
await page.keyboard.type('discussion'); await page.keyboard.press('Enter'); await sleep(500)
check('Ctrl-K finds a command and runs it', (await side()).title === 'discussion')
// a selection in the editor offers to comment on it; Ctrl-B makes it bold
await page.click('.cm-line:nth-child(22)'); await page.keyboard.press('End'); await page.keyboard.down('Shift'); await page.keyboard.press('Home'); await page.keyboard.up('Shift'); await sleep(300)
check('selected text offers a comment button', await page.evaluate(() => !!document.querySelector('.cm-ask')))
await page.keyboard.press('ArrowRight'); await page.keyboard.type(' boldme'); for (let i = 0; i < 6; i++) await page.keyboard.down('Shift'), await page.keyboard.press('ArrowLeft'), await page.keyboard.up('Shift')
await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control'); await sleep(200)
check('Ctrl-B wraps the selection in Typst bold', await page.evaluate(() => document.querySelector('.cm-content').textContent.includes('*boldme*')))
await page.keyboard.press('End'); for (let i = 0; i < 9; i++) await page.keyboard.press('Backspace')


// 3. Build: run "all" from the build pane, wait, see the preview keep working
await page.evaluate(() => document.getElementById('bar-build').click()); await sleep(1500)
await page.evaluate(() => [...document.querySelectorAll('#side-body .recipe')].find(r => r.textContent.includes('make all'))?.querySelector('button').click())
await sleep(25000)
const build = await page.evaluate(() => document.querySelector('.buildlog')?.textContent.slice(-400))
check('make all ran from the build pane', /typst compile main.typ/.test(build || ''))
const files = await page.evaluate(async () => (await (await fetch('/api/p/demo/files')).json()).map(f => f.path).filter(p => p.startsWith('out/')))
check('both PDFs produced', files.includes('out/report.pdf') && files.includes('out/summary.pdf'))
yes = true; await page.$eval('#tree .tnode.dir[title="out"] .del', b => b.click()); await sleep(1500); yes = false
check('a folder deletes with everything in it', !(await page.evaluate(async () =>
  (await (await fetch('/api/p/demo/files')).json()).some(f => f.path.startsWith('out/')))))

// 4. Ctrl-S saves (a signed commit) without asking; a named checkpoint asks for its name
await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control')
await page.waitForFunction(() => /saved/.test(document.getElementById('toast')?.textContent || ''), { timeout: 8000 }).catch(() => {})
check('Ctrl-S saves and says so', /saved/.test(await page.evaluate(() => document.getElementById('toast')?.textContent || '')))
await page.evaluate(() => document.querySelector('[data-act="checkpoint"]').click()); await sleep(4000)
await page.evaluate(() => document.querySelector('[data-act="history"]').click()); await sleep(1500)
const hist = await side(); check('history pane opens', !hist.hidden && hist.title === 'history')
const signed = await page.evaluate(() => [...document.querySelectorAll('.commit')].map(c => c.innerText.replace(/\s+/g, ' ')).slice(0, 3))
check('checkpoint shows signed badge', signed.some(c => /first signed checkpoint.*signed/.test(c)))

// 5. Share with an address that has no account yet: it is listed as invited
await page.evaluate(() => document.querySelector('[data-act="share"]').click()); await sleep(1500)
await page.type('#share-email', 'newcomer@example.com'); await page.click('#share-add button'); await sleep(1500)
check('sharing with a new address lists it as invited', await page.evaluate(() =>
  /newcomer@example\.com\s*invited/.test(document.getElementById('share-body').innerText)))
// ghost suggestions, from a stand-in for Ollama on this machine: like qwen3,
// a thinking model that cannot fill in the middle
let refuse = false
const ollama = (await import('node:http')).createServer((q, r) => {
  let b = ''; q.on('data', d => b += d); q.on('end', () => {
    const j = JSON.parse(b), h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    if (refuse) return r.writeHead(403).end() // as Ollama does: no CORS header, so a network error here
    if (j.suffix) return r.writeHead(400, h).end(JSON.stringify({ error: `${j.model} does not support insert` }))
    // slow, as a busy GPU is; raw, or it would answer instead of continue
    setTimeout(() => r.writeHead(200, h).end(JSON.stringify({ response: j.raw && j.think === false ? ' GHOSTED here. And on, and on' : 'You wrote: ...' })), 1500)
  })
}).listen(11434)
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))
await page.evaluate(() => document.querySelector('[data-act="ghost"]').click()); await sleep(300)
await page.click('.cm-content'); await page.keyboard.press('End'); await page.keyboard.type(' x'); await sleep(1100)
const waiting = await page.$eval('.cm-ghost', e => e.textContent).catch(() => null)
await page.keyboard.type(' GHO'); await sleep(2500) // typed while it thinks: what it says next still lands
const ghost = await page.$eval('.cm-ghost', e => e.textContent).catch(() => null)
await page.keyboard.press('Tab'); await sleep(300)
check('a local model (a slow, thinking one, with no fill-in-the-middle) shows it is thinking, then the rest of the sentence; Tab takes it',
  waiting === '…' && ghost === 'STED here.' && await page.evaluate(() => document.querySelector('.cm-content').textContent.includes('x GHOSTED here.')))
await page.keyboard.type(' z'); await sleep(2500); await page.keyboard.press('Escape'); await sleep(200)
check('Escape dismisses a suggestion', !(await page.$('.cm-ghost')))
refuse = true
await page.keyboard.type(' y'); await sleep(3000)
check('Ollama refusing the page says how to let it in', await page.evaluate(() =>
  document.getElementById('toast')?.textContent.includes(`OLLAMA_ORIGINS=${location.origin}`)))
ollama.close()

// focus: the text alone, centred, in a readable face; Alt-0 again, and all is back
await page.evaluate(() => document.querySelector('#menubar [data-act="focus"]').click()); await page.focus('.cm-content'); await sleep(500)
const w = await page.evaluate(() => { const c = document.querySelector('.cm-content').getBoundingClientRect(), e = document.getElementById('editor').getBoundingClientRect()
  return { preview: getComputedStyle(document.getElementById('preview')).display, bar: getComputedStyle(document.getElementById('bar')).display,
    left: c.left - e.left, right: e.right - c.right, width: c.width, full: e.width,
    font: getComputedStyle(document.querySelector('.cm-scroller')).fontFamily } })
await page.screenshot({ path: `${tmp}/ui-focus.png` })
await page.keyboard.press('Escape'); await sleep(500)
check('focus hides the preview and every bar, centres the text, reads in Atkinson', w.preview === 'none' && w.bar === 'none' &&
  w.font.includes('Atkinson') &&
  w.full > w.width + 100 && Math.abs(w.left - w.right) < 30 && await page.evaluate(() => getComputedStyle(document.getElementById('preview')).display !== 'none'))

// spelling: a misspelt word is marked and fixed from the mark; code is not
await page.focus('.cm-content'); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control')
await page.keyboard.type('\n\nThe water was recieved by the transcriptome. #let foo_bar = 1\n')
const marked = () => page.evaluate(() => [...document.querySelectorAll('.cm-spell')].map(e => e.textContent))
await page.waitForFunction(() => [...document.querySelectorAll('.cm-spell')].some(e => e.textContent === 'recieved'), { timeout: 60000 }).catch(() => {})
check('spelling marks a misspelt word, not code or a term of the field', (await marked()).includes('recieved') && !(await marked()).some(m => /foo|let|transcriptome/.test(m)))
await page.evaluate(() => { const e = [...document.querySelectorAll('.cm-spell')].find(e => e.textContent === 'recieved')
  getSelection().collapse(e.firstChild, 2) }); await sleep(300)
await page.evaluate(() => [...document.querySelectorAll('.cm-spell-tip button')].find(b => b.textContent === 'received')
  ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
check('a fix from the mark corrects the text', await page.evaluate(() => document.querySelector('.cm-content').innerText.includes('was received by')))
await page.focus('.cm-content'); await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control'); await sleep(3000)

// the surprise overlay, from a stand-in for a Perplexiscope engine: it scores
// the prose (never the markup), and each word lands on its own source text
const seen = []
const engine = new (await import('ws')).WebSocketServer({ port: 8765 })
engine.on('connection', ws => { ws.send(JSON.stringify({ type: 'hello', model: 'fake' })); ws.on('message', m => {
  const r = JSON.parse(m); seen.push(r.text)
  const words = [...r.text.matchAll(/\S+/g)].map(x => ({ s: x.index, e: x.index + x[0].length, bits: x[0].length * 2, rank: 5, ent: 2 + x[0].length, toks: [[x[0], x[0].length * 2]] }))
  ws.send(JSON.stringify({ type: 'heat', seq: r.seq, words, sents: [{ s: 0, e: r.text.trimEnd().length, w: words.length, n: words.length, bits: words.length * 6 }],
    ppl: 42, bpt: 5.4, ntok: words.length }))
  ws.send(JSON.stringify({ type: 'ai', seq: r.seq, score: 3, tail: 0.004, words: words.length, calibrated: false, family: 'gpt', task: 'write',
    sents: [{ score: 3, tail: 0.004 }] }))
}) })
answer = 'http://localhost:8765'
await page.evaluate(() => document.querySelector('[data-act="scope"]').click()); await sleep(2500); answer = null
// how each tinted word is coloured: warm (surprise) or cool (flatness)
const tinted = () => page.evaluate(() => [...document.querySelectorAll('.cm-content [style*="background"]')].map(e => {
  const [r, , b] = e.style.background.match(/\d+/g).map(Number); return { text: e.textContent, cool: b > r } }))
const sc = { bar: await page.evaluate(() => document.getElementById('scope').textContent), words: (await tinted()).map(w => w.text) }
check('the overlay tints words by surprise, and the bar gives the file\'s perplexity', sc.bar.startsWith('surprise · ppl 42.0') &&
  sc.words.length > 20 && (await tinted()).every(w => !w.cool))
check('it scores the prose, not the markup', seen.length && !/#(let|set)|@\w|\$/.test(seen.at(-1)) && /water sample was left/.test(seen.at(-1)) &&
  sc.words.every(w => !/^[#$@]/.test(w)))
await (await page.$('.cm-content [style*="background"]')).hover(); await sleep(800)
check('hovering a word says what its numbers mean', await page.evaluate(() =>
  /Surprise.*chance.*Rank.*Flatness.*unsure.*Sentence.*AI-likeness.*0\.4% of human sentences score this AI-like/s.test(document.querySelector('.cm-scope-tip')?.textContent)))
await page.mouse.move(0, 0); await page.click('#scope'); await sleep(800)
check('one click tints by flatness instead, from the same scores', (await tinted()).length > 20 && (await tinted()).every(w => w.cool) &&
  await page.evaluate(() => document.getElementById('scope').textContent.startsWith('flatness')) && seen.length === 1)
await page.click('#scope'); await sleep(800)
check('another shows AI-likeness per sentence', await page.evaluate(() => document.querySelectorAll('.scope-ai').length > 0 &&
  /AI: flagged/.test(document.getElementById('scope').textContent)))
answer = ''; await page.evaluate(() => document.querySelector('[data-act="scope"]').click()); await sleep(500); answer = null
check('and it turns off', await page.evaluate(() => !document.querySelector('.scope-ai') && document.getElementById('scope').hidden))
engine.close()

// someone else writes: the bar counts it, a note says it, a click shows it
await page.evaluate(() => document.getElementById('side-close').click())
await page.evaluate(() => fetch('/api/p/demo/members', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: '{"email":"bea@example.com"}' }))
const bea = await person('Bea', { hub: B, email: 'bea@example.com' }), beaDoc = bea.doc('demo'); await sleep(2000)
beaDoc.getArray('chat').push([{ id: 'b1', author: 'Bea', text: '@Ada look at the intro', ts: Date.now() }]); await sleep(1500)
check('a message from someone else is counted on the bar and said in a note', await page.evaluate(() =>
  document.querySelector('#bar-chat .badge').textContent === '1' && /Bea.*mentioned you.*look at the intro/.test(document.getElementById('toast')?.textContent)))
await page.click('#toast'); await sleep(600)
check('a click on the note opens the Discussion, and the count clears', (await side()).title === 'discussion' &&
  await page.evaluate(() => document.querySelector('#bar-chat .badge').hidden && !/^\(/.test(document.title)))
beaDoc.provider.destroy()

// the layout: one of three views, each a button in the bar; Reset layout restores the standard
const vis = () => page.evaluate(() => ['editor', 'preview', 'side']
  .map(id => getComputedStyle(document.getElementById(id)).display !== 'none' ? id[0] : '-').join(''))
await page.evaluate(() => document.querySelector('#menubar [data-act=comments]').click())
await page.click('#views [data-act=view-editor]'); const onlyEd = await vis()
await page.click('#views [data-act=view-preview]'); const onlyPv = await vis()
await page.evaluate(() => document.querySelector('#menubar [data-act=reset-layout]').click()); await sleep(200)
check('editor only, preview only, then Reset layout brings back both, panel closed', onlyEd === 'e-s' && onlyPv === '-ps' &&
  await vis() === 'ep-' && await page.evaluate(() => document.querySelector('#views [data-act=view-split]').ariaPressed === 'true'))

// a phone: the page fits the screen, and the tab bar shows one pane at a time
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await sleep(800)
const shows = async m => { await page.evaluate(m => document.querySelector(`#mtabs [data-m="${m}"]`).click(), m); await sleep(400)
  return page.evaluate(() => ['tree-pane', 'editor', 'preview', 'side'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none')) }
check('on a phone the page fits the screen', await page.evaluate(() => document.documentElement.scrollWidth <= 390))
check('and its tabs show one pane each', (await shows('files')).join() === 'tree-pane' && (await shows('edit')).join() === 'editor' &&
  (await shows('preview')).join() === 'preview' && (await shows('side')).join() === 'side')
await shows('preview')
check('the Preview tab picks which file to compile, and still fits', await page.evaluate(() => {
  const sel = document.getElementById('main-sel'), r = sel.getBoundingClientRect()
  return r.width > 40 && r.right <= 390 && [...sel.options].some(o => o.value === 'summary.typ') && document.documentElement.scrollWidth <= 390 }))
check('the other tabs leave it out', (await shows('edit')) && await page.evaluate(() => !document.getElementById('main-sel').getBoundingClientRect().width))
check('the word count sits under the Edit tab, and build in the tab bar opens the Build panel', await page.evaluate(() =>
  /\d+ words/.test(document.getElementById('mt-edit').textContent) && document.getElementById('mtabs').contains(document.getElementById('bar-build'))) &&
  (await page.evaluate(() => document.getElementById('bar-build').click()), await sleep(400),
   await page.evaluate(() => document.body.dataset.m === 'side') && (await side()).title === 'build'))
// Word: the citations are EndNote's fields, the bibliography its list
const word = await page.evaluate(async () => {
  const post = (u, body) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => r.json())
  const r = (await post('/api/projects/wordy', '{"template":"nih-r21"}')).ok && await post('/api/p/wordy/docx', '{"file":"main.typ"}')
  return r.ok && [...new Uint8Array(await (await fetch('/api/p/wordy/raw/' + r.path)).arrayBuffer())]
})
if (word) writeFileSync(`${tmp}/w.docx`, Buffer.from(word))
const xml = word ? (await import('node:child_process')).execSync(`unzip -p ${tmp}/w.docx word/document.xml`).toString() : ''
check('Word export makes the citations EndNote fields, the bibliography its list', /ADDIN EN\.CITE &lt;EndNote&gt;[\s\S]*ADDIN EN\.REFLIST/.test(xml))
const realErrors = errors.filter(e => !/awaiting project choice/.test(e))
check('no page errors or failed requests', realErrors.length === 0)
check('the app talks to no other host but this machine\'s model (fonts are bundled)', external.length === 0)
if (external.length) console.log('  external:', external.slice(0, 3).join(' '))
if (realErrors.length) console.log(realErrors.join('\n'))
await browser.close()
console.log(pass ? '\nUI ALL PASS' : '\nUI FAILURES')
process.exit(pass ? 0 : 1)
