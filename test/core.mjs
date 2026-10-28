// The core: templates, the CRDT and the disk, sync, comments, checkpoints
// and restore, builds, archives, and the guards around them.
import { HUB, Y, person, doc, check, done, sleep } from './lib.mjs'

const me = await person('Tester'), COOKIE = me.cookie, O = HUB
const api = (p, opt = {}) => me.res(p, opt).then(r => r.json())
await me.post('/projects/demo')
// any text file is editable, whatever its name; binaries are not
const { writeFileSync: put, mkdirSync, rmSync, existsSync: ex } = await import('node:fs')
put('data/demo/Containerfile', 'FROM scratch\n'); put('data/demo/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
put('data/demo/blob.bin', Buffer.from([0x50, 0x00, 0x4b]))
mkdirSync('data/demo/old'); put('data/demo/old/a.typ', 'a\n'); put('data/demo/old/b.txt', 'b\n')

const mk = () => me.doc('demo')
const nih = async t => (await api(`/projects/${t}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ template: t, brand: 'ucf' }) }), (await api(`/p/${t}/files`)).map(f => f.path))
const made = []; for (const t of ['nih-r21', 'nih-r03', 'nih-r25-sepa', 'nsf-cmi-goali', 'nih-r35-esi', 'nih-r35-established',
  'nsf-eager', 'nsf-aidatasets-impact', 'nsf-aidatasets-planning', 'nsf-cmmi', 'nsf-cmi-research', 'whitepaper-heilmeier', 'whitepaper-dod',
  'whitepaper-concept', 'arpah-1cure'])
  made.push(await nih(t))
const [r21, r03, sepa, goali, esi, mira, eager, aid, plan, cmmi, cmi, heil, dod, concept, cure] = made
const { readFileSync: get } = await import('node:fs')
check('templates are listed, report first, brands apart', (await api('/templates')).templates[0] === 'report' &&
  (await api('/templates')).brands.includes('ucf'))
check('an NIH template is its shared layer plus its own grant.yaml',
  ['main.typ', 'lib/nih.typ', 'letters.typ', 'grant.yaml'].every(f => r21.includes(f) && r03.includes(f)) &&
  /code: R21/.test(get('data/nih-r21/grant.yaml', 'utf8')) && /UCF Gold/.test(get('data/nih-r21/lib/brand.typ', 'utf8')) && /code: R03/.test(get('data/nih-r03/grant.yaml', 'utf8')))
check('the shared grant layer is offered to no one alone, and stands under NIH and NSF alike',
  !(await api('/templates')).templates.some(t => ['grant', 'nih', 'nsf'].includes(t)) &&
  ['lib/grant.typ', 'lib/budget.typ', 'checklist.typ'].every(f => r21.includes(f) && goali.includes(f)))
check('a SEPA R25: the program plan, its own attachments, no DMS plan in its package',
  ['humans.typ', 'sharing.typ'].every(f => sepa.includes(f)) && /Research Education Program Plan/.test(get('data/nih-r25-sepa/main.typ', 'utf8')) &&
  !/dmsp/.test(get('data/nih-r25-sepa/package.yaml', 'utf8')))
check('a MIRA, ESI or established: no Specific Aims anywhere, the word itself flagged, each NOFO\'s rules',
  [esi, mira].every(f => f.includes('main.typ') && !f.includes('aims.typ')) && !/#section\("aims"/.test(get('data/nih-r35-esi/main.typ', 'utf8')) &&
  /forbid: \[aims\?\]/.test(get('data/nih-r35-esi/grant.yaml', 'utf8')) && /effort: 51/.test(get('data/nih-r35-esi/grant.yaml', 'utf8')) &&
  /effort: 45/.test(get('data/nih-r35-established/grant.yaml', 'utf8')) && !(await api('/templates')).templates.includes('nih-r35'))
check('an NSF CMI GOALI: PAPPG format, the GOALI letter, no NIH files',
  ['lib/nsf.typ', 'goali-letter.typ', 'subaward.typ', 'mentoring.typ'].every(f => goali.includes(f)) && !goali.includes('lib/nih.typ') &&
  /^title: "GOALI: /m.test(get('data/nsf-cmi-goali/grant.yaml', 'utf8')))
const yml = t => get(`data/${t}/grant.yaml`, 'utf8')
check('NSF EAGER, AI Datasets, CMMI and CMI: each its solicitation\'s rules on the shared NSF layer',
  [eager, aid, cmmi, cmi].every(f => f.includes('lib/nsf.typ') && f.includes('package.yaml')) &&
  eager.includes('concept.typ') && /prefix: "EAGER:"/.test(yml('nsf-eager')) && /description: 8/.test(yml('nsf-eager')) &&
  /award: 400000/.test(yml('nsf-eager')) && /1\. Vision and community benefit for dataset enhancement/.test(get('data/nsf-aidatasets-impact/main.typ', 'utf8')) &&
  /Keywords:/.test(get('data/nsf-aidatasets-impact/summary.typ', 'utf8')) && cmmi.includes('onepager.typ') && /NSF 26-515/.test(yml('nsf-cmmi')) &&
  /prefix: "Instrument Development:"/.test(yml('nsf-cmi-research')) && !cmi.includes('goali-letter.typ'))
check('AI Datasets Planning: the Concept Outline and its email first, 8 pages, $100,000 a year, on the shared layer',
  ['concept.typ', 'note.typ', 'main.typ'].every(f => plan.includes(f)) && !aid.includes('concept.typ') &&
  /prefix: "AIDatasets:Planning:"/.test(yml('nsf-aidatasets-planning')) && /description: 8/.test(yml('nsf-aidatasets-planning')) &&
  /annual: 100000/.test(yml('nsf-aidatasets-planning')) && /Concurrence Email/.test(get('data/nsf-aidatasets-planning/package.yaml', 'utf8')) &&
  !(await api('/templates')).templates.includes('nsf-aidatasets'))
check('white papers, three styles on one layer: Heilmeier, a DoD BAA\'s (cover page, Times), a concept paper',
  [heil, dod, concept].every(f => ['lib/whitepaper.typ', 'note.typ', 'main.typ', 'budget.yaml'].every(x => f.includes(x))) &&
  /What are the risks\?/.test(get('data/whitepaper-heilmeier/main.typ', 'utf8')) &&
  /section\("cover"/.test(get('data/whitepaper-dod/main.typ', 'utf8')) && /Liberation Serif/.test(yml('whitepaper-dod')) &&
  /questions:/.test(yml('whitepaper-concept')) && !(await api('/templates')).templates.includes('whitepaper'))
check('ARPA-H 1-CURE: the solution summary first, four volumes, phases from the years',
  ['summary.typ', 'main.typ', 'volume2.typ', 'lib/arpah.typ', 'lib/grant.typ'].every(f => cure.includes(f)) &&
  /ARPA-H-SOL-26-147/.test(yml('arpah-1cure')) && /before: true/.test(get('data/arpah-1cure/package.yaml', 'utf8')))

const A = mk(), B = mk()
await sleep(1500)
const fA = A.getMap('files'), fB = B.getMap('files')

check('template loaded into Y map', fA.has('main.typ') && fA.has('scripts/analysis.py') && fA.has('Makefile'))
check('any text file is in the CRDT (Containerfile, .svg), a binary is not',
  fA.has('Containerfile') && fA.has('logo.svg') && !fA.has('blob.bin'))
// a folder removed on the hub's disk (rm -r) leaves every editor
const had = fB.has('old/a.typ') && fB.has('old/b.txt')
rmSync('data/demo/old', { recursive: true }); await sleep(1500)
check('rm -r on disk removes the folder from the CRDT', had && ![...fB.keys()].some(p => p.startsWith('old/')))
check('deleting a disk-only file from the editor works',
  (await api('/p/demo/raw/blob.bin', { method: 'DELETE' })).ok && !ex('data/demo/blob.bin'))
const json = '{"a": [1, 2]}\n' // a browser types a .json upload as JSON
check('an upload is stored as sent, whatever its type', (await me.res('/p/demo/raw/up.json', { method: 'PUT',
  headers: { 'content-type': 'application/json' }, body: json })).ok && get('data/demo/up.json', 'utf8') === json)
put('data/demo/.gitattributes', 'a.typ read-only\n'); await sleep(1500)
check('.gitattributes edited on disk reaches the editors (only .git/ is git\'s)',
  fA.get('.gitattributes')?.toString() === 'a.typ read-only\n')
check('generated build/ excluded from CRDT (disk-only)', ![...fA.keys()].some(p => p.startsWith('build/')))

// multi-file edit sync
fA.get('summary.typ').insert(0, '// edited by A\n')
fB.set('chapters/01.typ', new Y.Text('= Chapter one\n'))
await sleep(1200)
check('A edit visible to B', fB.get('summary.typ').toString().startsWith('// edited by A'))
check('B new nested file visible to A', fA.get('chapters/01.typ')?.toString() === '= Chapter one\n')

// comment anchor creep regression: comment on last 3 chars, then type after
const yt = fA.get('chapters/01.typ')
const from = yt.length - 4, to = yt.length - 1 // "one"
const rel = (i, assoc) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yt, i, assoc))).toString('base64')
A.getMap('comments').set('c1', { file: 'chapters/01.typ', author: 'A', text: 'rename?', anchor: rel(from, 0), head: rel(to, -1) })
yt.insert(yt.length, 'MORE TYPED TEXT')
await sleep(300)
const abs = s => Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(s, 'base64')), A).index
const c = A.getMap('comments').get('c1')
check('comment range did not creep over new text', yt.toString().slice(abs(c.anchor), abs(c.head)) === 'one')

// autosave mirror to disk
await sleep(2800)
const { execSync } = await import('node:child_process')
const onDisk = execSync('cat data/demo/chapters/01.typ').toString()
check('nested file mirrored to disk', onDisk.includes('Chapter one'))

// checkpoint + multi-file restore: delete a file, restore brings it back
await api('/p/demo/checkpoint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'pre-delete' }) })
const hist = await api('/p/demo/history')
const cp = hist.find(h => h.message.includes('pre-delete'))
fA.delete('summary.typ')
fA.get('main.typ').insert(0, 'GARBAGE ')
const mt = fA.get('main.typ'), at = mt.toString().indexOf('Pre-registration')
A.getMap('comments').set('c2', { file: 'main.typ', anchor: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(mt, at, 0))).toString('base64'),
  head: Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(mt, at + 16, -1))).toString('base64') })
fA.set('.git/config', new Y.Text('[core]\n\tfsmonitor = "touch PWNED"\n'))
await sleep(2800)
check('file deletion mirrored', !((await api('/p/demo/files')).some(f => f.path === 'summary.typ')))
await api(`/p/demo/restore/${cp.hash}`, { method: 'POST' })
await sleep(1200)
check('restore resurrected deleted file on both clients',
  fA.get('summary.typ')?.toString().startsWith('// edited by A') && fB.has('summary.typ'))
check('restore rolled back edit', !fB.get('main.typ').toString().includes('GARBAGE'))
const c2 = A.getMap('comments').get('c2')
check('restore keeps comments anchored outside the change', fA.get('main.typ').toString().slice(abs(c2.anchor), abs(c2.head)) === 'Pre-registration')
check('CRDT path cannot write .git/config', !execSync('cat data/demo/.git/config').toString().includes('fsmonitor'))
check('out/ PDFs excluded from history', !(await api('/p/demo/history')).length === false &&
  !execSync(`git -C data/demo ls-tree -r --name-only ${cp.hash}`).toString().includes('out/'))

// auth guards
const noauth = await fetch(`${HUB}/api/projects`)
check('REST rejects missing session', noauth.status === 401)
const badDoc = doc(HUB, 'demo', 'better-auth.session_token=not-a-real-session')
await sleep(1200)
check('websocket rejects invalid session', !badDoc.provider.isSynced && badDoc.getMap('files').size === 0)
badDoc.provider.destroy()

// recipes: discovered by parsing the Makefile, run in the sandbox (UNSAFE
// host mode in this CI)
const recipes = await api('/p/demo/recipes')
check('make targets listed', Array.isArray(recipes) && recipes.includes('report') && recipes.includes('analysis'))
check('file targets and .PHONY not offered as recipes',
  Array.isArray(recipes) && !recipes.some(r => r.includes('/') || r.startsWith('.')))
// a build may leave a nested repo (its config could run commands in the hub's git) or a symlink
mkdirSync('data/demo/nest/.git', { recursive: true }); (await import('node:fs')).symlinkSync('/etc', 'data/demo/escape')
const build = await api('/p/demo/build/analysis', { method: 'POST' })
check('build recipe runs', build.ok === true)
;(await import('node:fs')).appendFileSync('data/demo/Makefile', '\nwhere:\n\tpwd\n'); await sleep(300)
const where = await api('/p/demo/build/where', { method: 'POST' })
// .collab is the hub's: a link there (from an adopted repo, a remote, a build) is removed, never followed
await me.post('/projects/evil'); rmSync('data/evil/.collab', { recursive: true, force: true })
;(await import('node:fs')).symlinkSync('../demo/.collab', 'data/evil/.collab')
await api('/p/evil/template')
check('a project\'s .collab linked into another project is cut, the other left whole',
  !(await import('node:fs')).lstatSync('data/evil/.collab', { throwIfNoEntry: false })?.isSymbolicLink() && ex('data/demo/.collab/template.json'))
check('no answer names the data folder on this machine', /…\/demo/.test(where.output) && !where.output.includes(process.cwd()))
;(await import('node:fs')).appendFileSync('data/demo/Makefile', '\nnope:\n\tno-such-tool fig.py\n'); await sleep(300)
check('a command the sandbox lacks is named, with the way out',
  /`no-such-tool` is not in this hub's build sandbox.*just up/s.test((await api('/p/demo/build/nope', { method: 'POST' })).output))
const filesAfter = await api('/p/demo/files')
check('analysis output on disk', filesAfter.some(f => f.path === 'build/results.json'))
check('builds leave no nested repo or symlink behind', !ex('data/demo/nest/.git') && !(await import('node:fs')).existsSync('data/demo/escape'))
await sleep(600)
check('analysis output still not CRDT-managed', !fA.has('build/results.json'))
// a grant template: the whole application in one PDF, and the budget as Excel
const { execFileSync: sh } = await import('node:child_process')
let pyOk = true; try { sh('python3', ['-c', 'import pypdf, openpyxl']) } catch { pyOk = false }
if (!pyOk) console.log('SKIP grant full/budget builds (this host lacks pypdf/openpyxl; the build sandbox has them)')
else {
  const full = await api('/p/nih-r21/build/full', { method: 'POST' }), xl = await api('/p/nih-r21/build/budget', { method: 'POST' })
  const out = (await api('/p/nih-r21/files')).map(f => f.path)
  check('make full assembles the application, naming what is missing', out.includes('out/full.pdf') && /missing: Biographical Sketch/.test(full.output || ''))
  check('make budget writes the computed budget as Excel', out.includes('out/budget.xlsx') && /out\/budget\.xlsx/.test(xl.output || ''))
  for (const t of ['nih-r25-sepa', 'nsf-cmi-goali', 'nih-r35-esi', 'nih-r35-established', 'nsf-eager', 'nsf-aidatasets-impact',
    'nsf-aidatasets-planning', 'nsf-cmmi', 'nsf-cmi-research', 'whitepaper-heilmeier', 'whitepaper-dod', 'whitepaper-concept', 'arpah-1cure']) {
    const r = await api(`/p/${t}/build/full`, { method: 'POST' })
    check(`${t}: every attachment builds and the whole application assembles`, r.ok && /out\/full\.pdf/.test(r.output) && !/error/i.test(r.output))
  }
}
const tarList = async q => {
  const b = Buffer.from(await (await fetch(`${HUB}/api/p/demo/archive${q}`, { headers: { cookie: COOKIE } })).arrayBuffer())
  return (await import('node:child_process')).execFileSync('tar', ['-tzf', '-'], { input: b }).toString().split('\n')
}
const [src, everything] = [await tarList(''), await tarList('?all=1')]
check('sources archive: what git keeps, never .git or .collab', src.includes('main.typ') && src.includes('Makefile') &&
  !src.some(f => /(^|\/)\.(git|collab)\//.test(f)))
check('full archive adds build outputs', everything.some(f => /build\/results\.json$/.test(f)) &&
  !everything.some(f => /(^|\/)\.(git|collab)\//.test(f)))

// symlinks (planted by a build or a git checkout) never lead out of the project
const { symlinkSync, writeFileSync, readFileSync } = await import('node:fs')
symlinkSync(`${process.cwd()}/data/auth.db`, 'data/demo/leak.bin')
writeFileSync('data/outside', 'untouched'); symlinkSync(`${process.cwd()}/data/outside`, 'data/demo/trap.typ')
check('symlink out of the project not served', (await fetch(`${HUB}/api/p/demo/raw/leak.bin`, { headers: { cookie: COOKIE, origin: O } })).status === 400)
fA.set('trap.typ', new Y.Text('overwritten'))
await sleep(2800)
check('mirror does not write through a symlink', readFileSync('data/outside', 'utf8') === 'untouched')

// path traversal guards
const bad = await fetch(`${HUB}/api/p/demo/raw/../../etc/passwd`)
check('raw path traversal blocked', bad.status >= 400)

// one origin serves the client, the API and sync
const idx = await fetch(HUB + '/'), spa = await fetch(HUB + '/some/deep/route'), no = await fetch(HUB + '/api/nope')
check('the client, its SPA fallback, and /api apart', idx.ok && spa.ok && no.status >= 400 && !(await no.text()).includes('<!doctype'))
done()
