// Link mode end to end (`just test-link`): only the link is opened. The page
// comes from a static server on another origin and reaches the hub over iroh
// through a local relay, as it does from the static site through n0's.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const puppeteer = (await import(createRequire(path.resolve('.uitest/package.json')).resolve('puppeteer'))).default
let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const LINK = readFileSync(process.env.LINKFILE, 'utf8').trim()
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('dialog', d => d.accept())
await page.goto(LINK, { waitUntil: 'load' })
await page.waitForSelector('#auth-form', { timeout: 60000 })
check('sign-in screen arrives over iroh', true)
await page.click('.auth-tabs button[data-tab="up"]')
await page.type('input[name=name]', 'Ada'); await page.type('input[name=email]', 'ada@example.com'); await page.type('input[name=password]', 'password123')
await page.click('.auth-submit'); await sleep(3000)
const made = await page.evaluate(async () => (await fetch('/api/projects/demo', { method: 'POST' })).json())
check('signed in and created a project', made.ok === true)
await page.goto(LINK.replace('#', '?proj=demo#'), { waitUntil: 'load' }); await sleep(15000)
check('live preview compiled', await page.evaluate(() => document.getElementById('diag').hidden && !!document.querySelector('#page svg')))
check('sync connected', await page.evaluate(() => document.getElementById('status').dataset.state === 'connected'))
await page.focus('.cm-content'); await page.keyboard.type('LINKEDIT '); await sleep(8000)
const disk = readFileSync(`${process.env.DATA}/demo/main.typ`, 'utf8')
check('an edit in the browser reached the hub disk', disk.includes('LINKEDIT'))
await page.evaluate(() => document.querySelector('[data-act="share"]').click()); await sleep(2000)
check('share dialog shows the link', await page.evaluate(l => document.querySelector('#share-body input[readonly]')?.value === l, LINK))
errors.splice(0, errors.length, ...errors.filter(e => !/awaiting project choice/.test(e))); check('no page errors', errors.length === 0); if (errors.length) console.log(errors)
await browser.close(); process.exit(pass ? 0 : 1)
