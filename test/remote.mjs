// Git-remote sync: a bare repo stands in for GitHub/GitLab/Codeberg. Two
// hubs that never talk to each other directly must still converge through
// the remote, and concurrent edits must not conflict.
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Y, person, check, done, sleep, until } from './lib.mjs'
const run = promisify(execFile)

const A = process.env.HUB_A, B = process.env.HUB_B, DATA_A = process.env.DATA_A, DATA_B = process.env.DATA_B
const REMOTE = process.env.REMOTE, PROJ = 'gitpaper'
const hub = (base, who) => person(who, { hub: base })
const openDoc = async (h, proj) => { const d = h.doc(proj); await until(async () => d.files.has('main.typ')); return d }

const a = await hub(A, 'ann'), b = await hub(B, 'bob')

// A creates the project and points it at "the git server"
await a.post(`/projects/${PROJ}`)
const set = await a.post(`/p/${PROJ}/gitremote`, { url: REMOTE, branch: 'main' })
check('remote configured', set.configured === true && set.branch === 'main')
check('token-bearing URLs are redacted in status', !/:\/\/[^/@]*@/.test(set.url || ''))

const first = await a.post(`/p/${PROJ}/gitremote/sync`)
check('first push to the git server succeeded', first.ok === true)
const remoteFiles = (await run('git', ['-C', REMOTE, 'ls-tree', '-r', '--name-only', 'main'])).stdout
check('working tree is on the remote (readable on any git host)', /main\.typ/.test(remoteFiles) && /scripts\/analysis\.py/.test(remoteFiles))
check('git keeps the text, never the CRDT state', !/\.collab\/crdt/.test(remoteFiles))
check('build outputs are not pushed', !/(^|\n)out\//.test(remoteFiles))

// B adopts the project from the git server alone -- no peer online, no invite
const adopted = await b.post(`/projects/${PROJ}`, { gitUrl: REMOTE, branch: 'main' })
check('B adopted the project straight from the git remote', adopted.ok === true && adopted.adopted === true)
check('adopted files present on B', await until(async () => (await b.get(`/p/${PROJ}/files`)).some(f => f.path === 'main.typ')))

// Edits made independently on both hubs, then synced through the remote only
const docA = await openDoc(a, PROJ), docB = await openDoc(b, PROJ)
const MA = `// from A ${Date.now()}`, MB = `// from B ${Date.now()}`
docA.getMap('files').get('main.typ').insert(0, MA + '\n')
docB.getMap('files').set('notes-b.typ', new Y.Text(MB))
await sleep(3000)

await a.post(`/p/${PROJ}/gitremote/sync`)      // A pushes its edit
const bPull = await b.post(`/p/${PROJ}/gitremote/sync`)   // B merges + pushes its own
check('B merged the files A changed', bPull.ok === true && bPull.pulled >= 1)
check('A\'s edit reached B\'s disk through git',
  await until(async () => (await readFile(`${DATA_B}/${PROJ}/main.typ`, 'utf8')).includes(MA)))
const aPull = await a.post(`/p/${PROJ}/gitremote/sync`)   // A merges B's
check('A absorbed B\'s state', aPull.ok === true)
check('B\'s new file reached A\'s disk through git', await until(async () => (await readFile(`${DATA_A}/${PROJ}/notes-b.typ`, 'utf8')).includes(MB)))
check('each hub\'s document has a lineage of its own: A\'s copy is refused by B', await (async () => {
  let why = null
  const d = b.doc(PROJ, { parameters: { epoch: docA.getMap('meta').get('epoch') }, onAuthenticationFailed: e => why = e.reason })
  await sleep(1500); d.provider.destroy()
  return why === 'epoch'
})())
check('concurrent edits both survived (no clobber)',
  (await readFile(`${DATA_A}/${PROJ}/main.typ`, 'utf8')).includes(MA) &&
  (await readFile(`${DATA_B}/${PROJ}/notes-b.typ`, 'utf8')).includes(MB))

// Notes (comments, signatures) and history travel too
docA.getMap('comments').set('c1', { file: 'main.typ', text: 'check this' })
await sleep(500)
await a.post(`/p/${PROJ}/checkpoint`, { message: 'noted' })
await a.post(`/p/${PROJ}/gitremote/sync`)
const refs = (await run('git', ['-C', REMOTE, 'for-each-ref', '--format=%(refname)', 'refs/notes'])).stdout
check('comment notes pushed under the hub namespace', /refs\/notes\/[0-9a-f]+\/comments/.test(refs))
check('project history survives on the remote', (await run('git', ['-C', REMOTE, 'log', '--format=%s', 'main'])).stdout.includes('checkpoint: project created'))

// The remote is a normal repo: a plain clone gives you the paper
await run('rm', ['-rf', `${REMOTE}-clone`])
await run('git', ['clone', '-q', REMOTE, `${REMOTE}-clone`])
const cloned = await readFile(`${REMOTE}-clone/main.typ`, 'utf8')
check('a plain git clone yields the working project', cloned.includes(MA) && cloned.includes('#let R = json'))
check('no merge-conflict markers anywhere', !cloned.includes('<<<<<<<'))

// An agent (Claude Code, a script) works on a clone and pushes, while someone
// types in the same file: after the hub syncs, the editor holds both.
const { appendFile } = await import('node:fs/promises')
const g = (...a) => run('git', ['-C', `${REMOTE}-clone`, '-c', 'user.name=agent', '-c', 'user.email=agent@x', ...a])
await appendFile(`${REMOTE}-clone/summary.typ`, '\nAGENT WAS HERE\n')
await g('commit', '-qam', 'agent: one line'); await g('push', '-q', 'origin', 'main')
docA.getMap('files').get('summary.typ').insert(0, '// LIVE TYPING\n')
await sleep(2500)
await a.post(`/p/${PROJ}/gitremote/sync`)
const live = () => docA.getMap('files').get('summary.typ').toString()
check('an agent\'s pushed edit reaches the live editor', await until(async () => live().includes('AGENT WAS HERE')))
check('and typing done meanwhile survives it', live().includes('// LIVE TYPING'))

// An older hub's CRDT file on the remote: read if there, then taken out of git
await g('pull', '-q', '--no-rebase')
await (await import('node:fs/promises')).mkdir(`${REMOTE}-clone/.collab/crdt`, { recursive: true })
await (await import('node:fs/promises')).writeFile(`${REMOTE}-clone/.collab/crdt/old.bin`, Buffer.from([0, 0]))
await g('add', '-A'); await g('commit', '-qm', 'an older hub'); await g('push', '-q', 'origin', 'main')
await a.post(`/p/${PROJ}/gitremote/sync`)
check('an older hub\'s CRDT file is taken out of git', !/\.collab\/crdt/.test(
  (await run('git', ['-C', REMOTE, 'ls-tree', '-r', '--name-only', 'main'])).stdout))

// An agent editing the hub's own files on disk: merged into the live text
await appendFile(`${DATA_A}/${PROJ}/main.typ`, '\nDISK EDIT\n')
const mainA = () => docA.getMap('files').get('main.typ').toString()
check('an edit on the hub\'s disk reaches the live editor', await until(async () => mainA().includes('DISK EDIT')))
check('without losing what was there', mainA().includes(MA))

// A remote made with a README of its own (a history the project's never
// shared): joined, its README in the project, the project's files as they were
const own = `${REMOTE}-own`, w = `${REMOTE}-own-work`
await run('git', ['init', '-q', '--bare', '-b', 'main', own])
await run('git', ['clone', '-q', own, w])
const gw = (...x) => run('git', ['-C', w, '-c', 'user.name=x', '-c', 'user.email=x@x', ...x])
await gw('commit', '-q', '--allow-empty', '-m', 'Initial commit')
await (await import('node:fs/promises')).writeFile(`${w}/README.md`, '# made on GitHub\n')
await gw('add', '.'); await gw('commit', '-qm', 'README'); await gw('push', '-q', 'origin', 'main')
await a.post('/projects/joined')
await a.post('/p/joined/gitremote', { url: own, branch: 'main' })
const joined = await a.post('/p/joined/gitremote/sync')
const dj = await openDoc(a, 'joined')
check('a remote with a history of its own: joined, and pushed', joined.ok === true)
check('its README comes into the project, the project\'s files stay', await until(async () => dj.files.get('README.md')?.toString() === '# made on GitHub\n') && dj.files.has('main.typ'))
const ownLog = (await run('git', ['-C', own, 'log', '--format=%s', 'main'])).stdout
check('the remote keeps both histories', ownLog.includes('README') && ownLog.includes('checkpoint: project created'))

done()
