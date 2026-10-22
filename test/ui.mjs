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
  title: document.querySelector('#side-tabs .on')?.firstChild.textContent.toLowerCase(), body: document.getElementById('side-body').innerText.slice(0, 300) }))

await page.goto(B, { waitUntil: 'networkidle2', timeout: 60000 })
await page.waitForSelector('#auth-form'); await page.click('.auth-tabs button[data-tab="up"]')
await page.type('input[name=name]', 'Ada'); await page.type('input[name=email]', `ada${Date.now()}@example.com`); await page.type('input[name=password]', 'password123')
await page.click('.auth-submit'); await sleep(2000)
await page.evaluate(async () => (await fetch('/api/projects/demo', { method: 'POST' })).json())
await page.goto(`${B}/?proj=demo`, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(12000)
// A stand-in Typst Universe (server/packages.mjs): a template whose package
// imports another, so the preview fetches packages in two rounds
const universe = await (async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs'), { execSync } = await import('node:child_process')
  const d = mkdtempSync('/tmp/tydig-universe-'), pkg = (name, files) => {
    mkdirSync(`${d}/${name}/template`, { recursive: true })
    for (const [p, t] of Object.entries(files)) writeFileSync(`${d}/${name}/${p}`, t)
    execSync(`tar -czf ${d}/${name}-0.1.0.tar.gz -C ${d}/${name} .`)
  }
  pkg('tiny-dep', { 'typst.toml': '[package]\nname = "tiny-dep"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n',
    'lib.typ': '#let mark = [UNIVERSE-DEP]\n' })
  pkg('tiny-paper', { 'typst.toml': '[package]\nname = "tiny-paper"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n' +
    '[template]\npath = "template"\nentrypoint = "main.typ"\n', 'lib.typ': '#import "@preview/tiny-dep:0.1.0": mark\n' +
    '#let paper(body) = [#mark #body]\n', 'template/main.typ': '#import "@preview/tiny-paper:0.1.0": paper\n#show: paper\nHello from Universe.\n' })
  const index = JSON.stringify([{ name: 'tiny-paper', version: '0.1.0', description: 'A tiny paper', categories: ['paper'], template: {} }])
  return (await import('node:http')).createServer((q, r) => q.url === '/preview/index.json' ? r.end(index)
    : /^\/preview\/tiny-(paper|dep)-0\.1\.0\.tar\.gz$/.test(q.url) ? r.end(readFileSync(d + q.url.slice(8)))
    : (r.statusCode = 404, r.end())).listen(3998)
})()
const pv = await page.evaluate(() => ({ diagHidden: document.getElementById('diag').hidden, svg: document.querySelectorAll('#page svg use, #page svg path').length > 0, diag: document.getElementById('diag').textContent.slice(0, 200) }))
check('preview compiled on a fresh project (no missing files)', pv.diagHidden && pv.svg)
if (!pv.diagHidden) console.log('  diag:', pv.diag)

// The worker keeps the files it was sent: a new file, an edit and a deletion
// each reach it (a file deleted must not compile from its old copy)
{
  const { doc, Y } = await import('./lib.mjs')
  const d = doc(B, 'demo', (await page.cookies()).find(c => c.name.endsWith('session_token')).value)
  await sleep(2000)
  const shows = () => page.evaluate(() => ({ text: document.getElementById('page').textContent,
    diag: !document.getElementById('diag').hidden && document.getElementById('diag').textContent }))
  const main = d.files.get('main.typ'), tail = '\n#include "extra.typ"\n'
  d.transact(() => { d.files.set('extra.typ', new Y.Text('Zanzibarxq')); main.insert(main.length, tail) }); await sleep(4000)
  const added = await shows()
  d.files.get('extra.typ').delete(0, 10); d.files.get('extra.typ').insert(0, 'Quokkaqq'); await sleep(4000)
  const edited = await shows()
  d.files.delete('extra.typ'); await sleep(4000)
  const gone = await shows()
  main.delete(main.length - tail.length, tail.length); await sleep(4000)
  const back = await shows()
  check('the preview follows a file added, edited and deleted, then recovers', added.text.includes('Zanzibarxq') &&
    edited.text.includes('Quokkaqq') && !edited.text.includes('Zanzibarxq') && /extra\.typ/.test(gone.diag) && !back.diag)
  d.provider.destroy()
}

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

// Double-click a word in the preview: the editor goes to it. Mod-Alt-J: back,
// the cursor's text selected in the preview
await page.evaluate(() => getSelection().removeAllRanges())
const newton = await page.evaluate(() => {
  const w = document.createTreeWalker(document.getElementById('page'), NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) { const i = n.data.indexOf('Newton')
    if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } } }
})
if (newton) await page.mouse.click(newton.x, newton.y, { count: 2, clickCount: 2 })
await sleep(800)
const jumped = await page.evaluate(() => document.querySelector('.cm-activeLine')?.textContent ?? '')
check('double-clicking a word in the preview goes to it in the source', !!newton && jumped.includes('Newton'))
// a word found all over: its own, by the text around it
const the = await page.evaluate(() => {
  const w = document.createTreeWalker(document.getElementById('page'), NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) { const i = n.data.indexOf('rule: the ')
    if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 6); r.setEnd(n, i + 9); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } } }
})
if (the) await page.mouse.click(the.x, the.y, { count: 2, clickCount: 2 })
await sleep(800)
check('double-clicking "the" goes to that "the"', !!the && await page.evaluate(() => getSelection().toString() === 'the' &&
  document.querySelector('.cm-activeLine')?.textContent.includes('decision rule: the')))
if (newton) await page.mouse.click(newton.x, newton.y, { count: 2, clickCount: 2 })
await sleep(800)
await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('j')
await page.keyboard.up('Alt'); await page.keyboard.up('Control'); await sleep(500)
const toPv = await page.evaluate(() => { const r = [...CSS.highlights.get('pv-at') ?? []][0]
  return { sel: r?.toString() ?? '', inPage: !!r && document.getElementById('page').contains(r.startContainer) } })
check('Mod-Alt-J marks the cursor\'s text in the preview', toPv.inPage && jumped.includes(toPv.sel) && toPv.sel.length > 1)
if (!toPv.inPage) console.log('  ', JSON.stringify(toPv), jumped.slice(0, 80))
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
check('and a cite button, which asks how: the bibliography, papers in context, or for the text alone', await page.evaluate(() => {
  [...document.querySelectorAll('.cm-ask button')].find(b => /Cite/.test(b.textContent)).click()
  return [...document.querySelectorAll('.cm-ask button span')].map(s => s.firstChild.textContent).join('|') ===
    'From the bibliography…|Find papers, in context|Find papers for this text alone' }))
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
  /Surprise.*chance.*Rank.*Flatness.*unsure.*Sentence.*AI-likeness 78%: 0\.4% of human sentences read this AI-like/s.test(document.querySelector('.cm-scope-tip')?.textContent)))
await page.mouse.move(0, 0); await page.click('#scope'); await sleep(800)
check('one click tints by flatness instead, from the same scores', (await tinted()).length > 20 && (await tinted()).every(w => w.cool) &&
  await page.evaluate(() => document.getElementById('scope').textContent.startsWith('flatness')) && seen.length === 1)
// typing keeps the marks; in vim the text is read on leaving insert mode
await page.evaluate(() => document.querySelector('#menubar [data-act=vim]').click()); await sleep(300)
await page.focus('.cm-content'); await page.keyboard.type('ggIVery '); await sleep(1500)
const held = { n: seen.length, marks: (await tinted()).length }
await page.keyboard.press('Escape'); await sleep(800)
check('typing keeps the marks; in vim, the text is read on leaving insert mode',
  held.n === 1 && held.marks > 20 && seen.length === 2 && seen[1].startsWith('Very'))
await page.keyboard.type('^5x'); await sleep(1200)
await page.evaluate(() => document.querySelector('#menubar [data-act=vim]').click()); await sleep(300)
await page.click('#scope'); await sleep(800)
check('another shows AI-likeness per sentence, the most AI-like blocked out', await page.evaluate(() =>
  document.querySelectorAll('.scope-ai.ai-top').length > 0 && /AI 78%/.test(document.getElementById('scope').textContent)))
await page.evaluate(() => document.getElementById('bar-ai').click()); await sleep(300)
await page.evaluate(() => document.querySelector('#side-body .go').click()); await sleep(3000)
check('the AI check reads the document as typeset, and lists the most AI-like sentences, each a click away', await page.evaluate(() =>
  /1 blocked out/.test(document.getElementById('side-body').innerText) && document.querySelectorAll('#side-body .ai-row').length > 0) &&
  /report \u22c5 generated/.test(seen.at(-1)))
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

// keys: Mod-\ hides the preview; in vim, Space 3 is the preview alone, :only the editor; ? lists them
const v = () => page.evaluate(() => document.body.dataset.view), key = async (...k) => { for (const x of k) await page.keyboard.press(x); await sleep(150) }
await page.keyboard.down('Control'); await key('Backslash'); await page.keyboard.up('Control'); const hid = await v()
await page.evaluate(() => document.querySelector('#menubar [data-act=vim]').click()); await sleep(300)
await page.click('.cm-line:nth-child(22)'); await key('Escape', 'Space', '3'); const leader = await v()
await page.evaluate(() => document.querySelector('#views [data-act=view-split]').click())
await page.click('.cm-line:nth-child(22)'); await key('Escape'); await page.keyboard.type(':only'); await key('Enter'); const ex = await v()
await page.click('#projname'); await key('?'); const help = await page.evaluate(() => document.getElementById('keys').open)
await key('Escape'); await page.evaluate(() => { document.querySelector('#menubar [data-act=vim]').click(); document.querySelector('#menubar [data-act=reset-layout]').click() })
check('Mod-\\ hides the preview; in vim Space 3 shows it alone, :only the editor; ? lists the keys',
  hid === 'editor' && leader === 'preview' && ex === 'editor' && help)

// tags: a file made read-only from the tree takes no typing, is labelled, and is made editable again
const tagIt = async label => { await page.evaluate(() => [...document.querySelectorAll('#tree .tnode')]
  .find(n => n.title === 'summary.typ').querySelector('.tg').click()); await sleep(200)
  await page.evaluate(l => [...document.querySelectorAll('#qo-list div')].find(d => d.textContent.startsWith(l)).click(), label); await sleep(600) }
await tagIt('Make read-only'); await tagIt('Mark as AI-generated')
await page.evaluate(() => [...document.querySelectorAll('#tree .tnode')].find(n => n.title === 'summary.typ').click()); await sleep(800)
const before = await page.evaluate(() => document.querySelector('.cm-content').textContent)
await page.click('.cm-content'); await page.keyboard.type('zzz'); await sleep(300)
const ro = { same: await page.evaluate(b => document.querySelector('.cm-content').textContent === b, before),
  chips: await page.evaluate(() => document.getElementById('filetags').textContent),
  badges: await page.evaluate(() => [...document.querySelectorAll('#tree .tnode')].find(n => n.title === 'summary.typ').querySelectorAll('.ftag').length),
  attrs: await page.evaluate(async () => (await (await fetch('/api/p/demo/files')).json()).length) }
await tagIt('Make editable'); await page.click('.cm-content'); await page.keyboard.type('Q'); await sleep(300)
check('a file tagged read-only and AI-generated takes no typing, says so, and is editable again when untagged',
  ro.same && /AI-generated/.test(ro.chips) && /read-only/.test(ro.chips) && ro.badges === 2 &&
  await page.evaluate(() => document.querySelector('.cm-content').textContent.includes('Q')))
await page.keyboard.press('Backspace'); await tagIt('Not AI-generated')

// a page opens on the preview the hub keeps, before its own compiler has loaded; then compiles its own
await sleep(6500); const wasm = [], onWasm = r => /typst_ts_web_compiler/.test(r.url()) && wasm.push(r.url())
page.on('request', onWasm); await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('#page img, #page svg'), { timeout: 30000 })
const kept = await page.evaluate(() => !!document.querySelector('#page img')), early = wasm.length
await page.waitForFunction(() => document.querySelector('#page svg'), { timeout: 90000 }); page.off('request', onWasm)
check('a page opens on the preview the hub keeps, before loading a compiler; then compiles its own', kept && !early)

// the bar never runs off the page: what the menus hold gives way
const spills = []
for (let w = 640; w <= 1800; w += 40) {
  await page.setViewport({ width: w, height: 900 }); await sleep(150)
  if (await page.evaluate(() => { const b = document.getElementById('bar'); return b.scrollWidth > b.clientWidth })) spills.push(w)
}
check('the top bar fits at every width', !spills.length)
if (spills.length) console.log('  spills at', spills.join())

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
check('the word count sits under the Edit tab; the Panel tab opens the panel, its own tabs pick Build', await page.evaluate(() =>
  /\d+ words/.test(document.getElementById('mt-edit').textContent)) && (await shows('side')).join() === 'side' &&
  (await page.evaluate(() => [...document.querySelectorAll('#side-tabs button')].find(b => b.firstChild.textContent === 'Build').click()),
   await sleep(400), (await side()).title === 'build'))
// Word: the citations are EndNote's fields, the bibliography its list
const word = await page.evaluate(async () => {
  const post = (u, body) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => r.json())
  const r = (await post('/api/projects/wordy', '{"template":"nih-r21"}')).ok && await post('/api/p/wordy/docx', '{"file":"main.typ"}')
  return r.ok && [...new Uint8Array(await (await fetch('/api/p/wordy/raw/' + r.path)).arrayBuffer())]
})
if (word) writeFileSync(`${tmp}/w.docx`, Buffer.from(word))
const xml = word ? (await import('node:child_process')).execSync(`unzip -p ${tmp}/w.docx word/document.xml`).toString() : ''
check('Word export makes the citations EndNote fields, the bibliography its list', /ADDIN EN\.CITE &lt;EndNote&gt;[\s\S]*ADDIN EN\.REFLIST/.test(xml))
{ // an offline copy of another lineage (the hub rebuilt from git): refused, cleared, its text offered back
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto(`${B}/?proj=demo`, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(4000)
  const { doc, Y } = await import('./lib.mjs')
  const d = doc(B, 'demo', (await page.cookies()).find(c => c.name.endsWith('session_token')).value); await sleep(2000)
  const sv = Y.encodeStateVector(d); d.provider.disconnect()
  d.transact(() => { d.getMap('meta').set('epoch', 'another'); d.files.get('main.typ').insert(0, 'OFFLINE-ONLY\n') })
  const u = [...Y.encodeStateAsUpdate(d, sv)]; d.provider.destroy()
  await page.evaluate(u => new Promise(ok => { const r = indexedDB.open('tydig:demo')
    r.onsuccess = () => { const t = r.result.transaction('updates', 'readwrite'); t.objectStore('updates').add(new Uint8Array(u)); t.oncomplete = ok } }), u)
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(9000)
  const after = await page.evaluate(() => ({ review: document.getElementById('status').dataset.review,
    side: document.getElementById('side-body').innerText.slice(0, 400), doc: document.querySelector('.cm-content')?.textContent.slice(0, 200) }))
  check('a copy of another lineage is refused and cleared: the text shows once, the offline edit offered to restore',
    after.review === '1' && /main\.typ/.test(after.side) && /OFFLINE-ONLY/.test(after.side) && !/OFFLINE-ONLY/.test(after.doc))
  if (after.review !== '1') console.log(JSON.stringify(after))
}
{ // a project from a Typst Universe template: its files, and its packages through the hub
  await page.setViewport({ width: 1400, height: 900 })
  const made = await page.evaluate(async () => (await fetch('/api/projects/uni', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: '@preview/tiny-paper:0.1.0' }) })).json())
  const cookie = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ')
  const none = (await fetch(`${B}/api/projects/nope`, { method: 'POST', headers: { cookie, origin: B,
    'content-type': 'application/json' }, body: JSON.stringify({ template: '@preview/no-such:1.0.0' }) })).status
  await page.goto(`${B}/?proj=uni`, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(8000)
  const shown = await page.evaluate(() => ({ text: document.getElementById('page').textContent,
    diag: !document.getElementById('diag').hidden && document.getElementById('diag').textContent }))
  const found = await page.evaluate(async () => (await (await fetch('/api/universe')).json()).map(t => t.spec))
  check('a project from a Typst Universe template previews, its packages fetched through the hub',
    made.ok && /UNIVERSE-DEP\s*Hello from Universe/.test(shown.text) && !shown.diag && found.includes('@preview/tiny-paper:0.1.0'))
  check('a template Universe lacks makes no project', none === 404)
  if (shown.diag) console.log('  diag:', shown.diag)
  universe.close()
}
{ // the divider: the panes follow the drag; the layout is kept once let go
  await page.setViewport({ width: 1400, height: 900 }); await sleep(300)
  await page.evaluate(() => document.querySelector('#views [data-act=view-split]').click()); await sleep(300)
  const b = await (await page.$('#split')).boundingBox(), y = b.y + b.height / 2
  const kept = () => page.evaluate(() => JSON.parse(localStorage.settings || '{}').split)
  const was = await kept(), flex = () => page.evaluate(() => parseFloat(document.getElementById('editor').style.flex))
  await page.mouse.move(b.x + b.width / 2, y); await page.mouse.down(); await page.mouse.move(b.x - 200, y, { steps: 5 })
  const [mid, midKept] = [await flex(), await kept()]
  await page.mouse.up(); await sleep(100)
  const end = await kept()
  check('dragging the divider moves the panes at once and keeps where it was let go', mid < (was ?? 0.5) - 0.05 &&
    midKept === was && Math.abs(end - mid) < 1e-4)
  await page.click('#split', { count: 2, clickCount: 2 })
}
const realErrors = errors.filter(e => !/awaiting project choice/.test(e))
check('no page errors or failed requests', realErrors.length === 0)
check('the app talks to no other host but this machine\'s model (fonts are bundled)', external.length === 0)
if (external.length) console.log('  external:', external.slice(0, 3).join(' '))
if (realErrors.length) console.log(realErrors.join('\n'))
await browser.close()
console.log(pass ? '\nUI ALL PASS' : '\nUI FAILURES')
process.exit(pass ? 0 : 1)
