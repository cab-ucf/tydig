// Browser-level test: drives the built client in headless Chrome. This is the
// suite that catches what the API suites cannot -- panes that render into a
// hidden element, preview compiles that fail on missing files, UI labels.
// Run via `just test-ui`, which installs puppeteer (and its Chrome) on demand
// into .uitest/ so the app's own dependency tree stays lean.
import { createRequire } from 'node:module'
import path from 'node:path'
const puppeteer = (await import(createRequire(path.resolve('.uitest/package.json'))
  .resolve('puppeteer'))).default
let pass = true
const check = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); pass &&= cond }
const B = process.env.B || 'http://localhost:3000'
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
page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept(d.defaultValue() || 'first signed checkpoint'); else if (d.type() === 'confirm' && yes) await d.accept(); else await d.dismiss() })
let yes = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
const side = () => page.evaluate(() => ({ hidden: document.getElementById('side').hidden, title: document.getElementById('side-title').textContent, body: document.getElementById('side-body').innerText.slice(0, 300) }))

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
let s = await side(); if (s.hidden) { await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt'); await sleep(500); s = await side() }
check('comments pane opens', !s.hidden && s.title === 'comments')


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
await page.keyboard.down('Alt'); await page.keyboard.press('h'); await page.keyboard.up('Alt'); await sleep(1500)
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
    r.writeHead(200, h).end(JSON.stringify({ response: /^qwen/.test(j.model) && j.think === false ? ' GHOSTED' : '' }))
  })
}).listen(11434)
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))
await page.evaluate(() => document.querySelector('[data-act="ghost"]').click()); await sleep(300)
await page.click('.cm-content'); await page.keyboard.press('End'); await page.keyboard.type(' x'); await sleep(1500)
const ghost = await page.$eval('.cm-ghost', e => e.textContent).catch(() => null)
await page.keyboard.press('Tab'); await sleep(300)
check('a local model suggests in grey (a thinking one, with no fill-in-the-middle, too), and Tab takes it', ghost === ' GHOSTED' &&
  await page.evaluate(() => document.querySelector('.cm-content').textContent.includes('x GHOSTED')))
refuse = true
await page.keyboard.type(' y'); await sleep(1500)
check('Ollama refusing the page says how to let it in', await page.evaluate(() =>
  document.getElementById('toast')?.textContent.includes(`OLLAMA_ORIGINS=${location.origin}`)))
ollama.close()

// a phone: the page fits the screen, and the tab bar shows one pane at a time
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await sleep(800)
const shows = async m => { await page.evaluate(m => document.querySelector(`#mtabs [data-m="${m}"]`).click(), m); await sleep(400)
  return page.evaluate(() => ['tree-pane', 'editor', 'preview', 'side'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none')) }
check('on a phone the page fits the screen', await page.evaluate(() => document.documentElement.scrollWidth <= 390))
check('and its tabs show one pane each', (await shows('files')).join() === 'tree-pane' && (await shows('edit')).join() === 'editor' &&
  (await shows('preview')).join() === 'preview' && (await shows('side')).join() === 'side')
const realErrors = errors.filter(e => !/awaiting project choice/.test(e))
check('no page errors or failed requests', realErrors.length === 0)
check('the app talks to no other host but this machine\'s model (fonts are bundled)', external.length === 0)
if (external.length) console.log('  external:', external.slice(0, 3).join(' '))
if (realErrors.length) console.log(realErrors.join('\n'))
await browser.close()
console.log(pass ? '\nUI ALL PASS' : '\nUI FAILURES')
process.exit(pass ? 0 : 1)
