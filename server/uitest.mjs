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
page.on('response', r => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`) })
const external = []
page.on('request', r => { if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).origin !== new URL(B).origin) external.push(r.url()) })
page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept('first signed checkpoint'); else await d.dismiss() })
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

// 4. Signed checkpoint via Ctrl-S then history pane
await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control'); await sleep(4000)
await page.keyboard.down('Alt'); await page.keyboard.press('h'); await page.keyboard.up('Alt'); await sleep(1500)
const hist = await side(); check('history pane opens', !hist.hidden && hist.title === 'history')
const signed = await page.evaluate(() => [...document.querySelectorAll('.commit')].map(c => c.innerText.replace(/\s+/g, ' ')).slice(0, 3))
check('checkpoint shows signed badge', signed.some(c => /first signed checkpoint.*signed/.test(c)))
const realErrors = errors.filter(e => !/awaiting project choice/.test(e))
check('no page errors or failed requests', realErrors.length === 0)
check('the app talks to no other host (fonts are bundled)', external.length === 0)
if (external.length) console.log('  external:', external.slice(0, 3).join(' '))
if (realErrors.length) console.log(realErrors.join('\n'))
await browser.close()
console.log(pass ? '\nUI ALL PASS' : '\nUI FAILURES')
process.exit(pass ? 0 : 1)
