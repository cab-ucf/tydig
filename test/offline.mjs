// Offline editing: edits made apart merge on reconnect, even after the hub
// unloaded the document (it must reload the same CRDT, not re-seed it).
import { person, check, done, sleep } from './lib.mjs'

const me = await person('Off'), P = 'offl' + Date.now().toString(36)
await me.post(`/projects/${P}`)
const A = me.doc(P), B = me.doc(P)
await sleep(1500)
check('both clients synced the template', A.files.has('main.typ') && B.files.has('main.typ'))

A.provider.disconnect(); await sleep(300)
B.files.get('main.typ').insert(0, 'BBB-remote\n')
A.files.get('main.typ').insert(0, 'AAA-local\n')
await sleep(500)
check('offline A did not see B yet', !A.files.get('main.typ').toString().includes('BBB-remote'))
A.provider.connect(); await sleep(1500)
const merged = A.files.get('main.typ').toString()
check('after reconnect both edits are there', merged.includes('AAA-local') && merged.includes('BBB-remote'))
check('both clients converge', merged === B.files.get('main.typ').toString())

const id = A.files.get('main.typ')._item.id
A.provider.destroy(); B.provider.destroy(); await sleep(3500)
A.files.get('main.typ').insert(0, 'AFTER-UNLOAD\n')
const C = me.doc(P); await sleep(1500)
const c = C.files.get('main.typ')._item.id
check('the reloaded doc keeps its CRDT identity', c.client === id.client && c.clock === id.clock)
const A2 = me.doc(P, { document: A }); await sleep(1500)
check('an edit made offline after unload survives', C.files.get('main.typ').toString().includes('AFTER-UNLOAD'))
// A copy of another lineage (the hub rebuilt from git, the project made
// again) is refused, never merged: merged, its text would show twice
const lineage = C.getMap('meta').get('epoch')
check('the hub gives its document a lineage', typeof lineage === 'string' && lineage.length > 8)
let refused = null
const D = me.doc(P, { parameters: { epoch: 'another' }, onAuthenticationFailed: e => refused = e.reason }); await sleep(1500)
check('an offline copy of another lineage is refused, not merged', refused === 'epoch' && !D.files.size)
const E = me.doc(P, { parameters: { epoch: lineage } }); await sleep(1500)
check('a copy of its own lineage syncs', E.files.get('main.typ')?.toString().includes('AFTER-UNLOAD'))
A2.provider.destroy(); C.provider.destroy(); D.provider.destroy(); E.provider.destroy()
done()
