// Switching a project's template: merged three ways, so what the new template
// changes lands and what people wrote stays.
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { person, check, done, sleep, until } from './lib.mjs'

const Ann = await person('Ann'), Bob = await person('Bob'), ann = Ann.cookie, bob = Bob.cookie
const as = (cookie, p, o = {}) => (cookie === ann ? Ann : Bob).res(p, { ...o, headers: { 'content-type': 'application/json' } })
const json = async (cookie, p, body) => (await as(cookie, p, body && { method: 'POST', body: JSON.stringify(body) })).json()
const open = async name => { const d = Ann.doc(name); await until(async () => d.files.size > 0); return d }
const text = (doc, f) => doc.getMap('files').get(f)?.toString()
const edit = (doc, f, a, b) => { const t = doc.getMap('files').get(f), i = t.toString().indexOf(a); t.delete(i, a.length); t.insert(i, b) }

// an R21, edited, becomes an R03: the mechanism changes, the writing stays
await json(ann, '/projects/grant', { template: 'nih-r21' })
const g = await open('grant')
edit(g, 'grant.yaml', 'Exploratory study of a new approach to a hard problem', 'Thermal relaxation in small samples')
edit(g, 'main.typ', '*Expected outcome:*', '*What we expect:*')
edit(g, 'budget.yaml', 'salary: 120000', 'salary: 125000')
await sleep(2500)
check('the template a project was made from is recorded', (await json(ann, '/p/grant/template')).template === 'nih-r21')
await as(ann, '/p/grant/members', { method: 'POST', body: JSON.stringify({ email: 'bob@example.com' }) })
check('a member cannot switch it', (await as(bob, '/p/grant/template', { method: 'POST', body: JSON.stringify({ template: 'nih-r03' }) })).status === 403)
const r1 = await json(ann, '/p/grant/template', { template: 'nih-r03' })
await sleep(500)
const gy = text(g, 'grant.yaml')
check('R21 to R03: the mechanism is now an R03', /code: R03/.test(gy) && /cap: \{ year: 50000/.test(gy) && !/code: R21/.test(gy))
check('and the title written for it stays', gy.includes('Thermal relaxation in small samples'))
check('the budget was edited where the R03 one differs: yours kept there, and said so', /salary: 125000/.test(text(g, 'budget.yaml')) &&
  r1.merged.includes('budget.yaml') && r1.kept.some(([f]) => f === 'budget.yaml'))
check('where the R03 budget differs and yours does not, the R03 lands', /cost: \[8000, 6000\]/.test(text(g, 'budget.yaml')))
check('files the templates share are left alone', text(g, 'main.typ').includes('*What we expect:*') && !r1.beside.length)
check('it is recorded, and committed as a checkpoint', (await json(ann, '/p/grant/template')).template === 'nih-r03' &&
  (await json(ann, '/p/grant/history'))[0].message.startsWith('checkpoint: template nih-r21 -> nih-r03'))

// a report, written in, becomes a grant: its writing is kept and the grant's structure is set beside it
await json(ann, '/projects/paper', {})
const p = await open('paper')
p.getMap('files').get('main.typ').insert(0, '// my own paper\n')
await sleep(2500)
rmSync('data/paper/.collab/template.json') // as from before templates were recorded
const r2 = await json(ann, '/p/paper/template', { template: 'nih-r21', brand: 'ucf' })
await sleep(800)
check('a report to a grant: your main.typ stays, the grant\'s is set beside it', text(p, 'main.typ').startsWith('// my own paper') &&
  r2.beside.some(([a, b]) => a === 'main.typ' && b === 'main.nih-r21.typ') && text(p, 'main.nih-r21.typ')?.includes('#section("aims"'))
check('the grant\'s files arrive', ['grant.yaml', 'package.yaml', 'lib/nih.typ', 'budget.yaml'].every(f => r2.added.includes(f)) && text(p, 'lib/brand.typ')?.includes('UCF'))
check('the report\'s untouched files go', r2.removed.includes('scripts/analysis.py') && !existsSync('data/paper/scripts/analysis.py'))

// a project made from an older version of a template: a file it never
// changed is the template's to update, though today's template differs from it
await json(ann, '/projects/aged', { template: 'nih-r21' })
const a = await open('aged'), was = '// lib/nih.typ as the template once was\n'
const t = a.getMap('files').get('lib/nih.typ'); t.delete(0, t.length); t.insert(0, was)
writeFileSync('data/aged/.collab/base/lib/nih.typ', was)
await sleep(2500)
const r3 = await json(ann, '/p/aged/template', { template: 'nih-r03' })
await sleep(500)
check('a file from an older template, never changed, is updated to today\'s', r3.updated.includes('lib/nih.typ') &&
  text(a, 'lib/nih.typ') === readFileSync(new URL('../templates/nih/lib/nih.typ', import.meta.url), 'utf8'))
check('and what the template gave is kept for the next switch', readFileSync('data/aged/.collab/base/grant.yaml', 'utf8').includes('code: R03'))

done()
