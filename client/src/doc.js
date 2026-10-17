// The project's shared document (a Yjs CRDT): its offline copy, its sync with
// the hub, who is here, and which files it holds.
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { $, link, me, projName } from './util.js'
import { openPicker } from './dialogs.js'
import { FILE as TAGFILE, TAGS, tagsOf, setTag } from '../../server/tags.mjs'

if (!projName) { openPicker(); throw new Error('awaiting project choice') }

export const ydoc = new Y.Doc()
export const files = ydoc.getMap('files') // path -> Y.Text
export const comments = ydoc.getMap('comments')
export const chat = ydoc.getArray('chat') // the Discussion; a message with `re` answers a comment
export const meta = ydoc.getMap('meta') // diskRev: bumped by the hub whenever the disk changes
// offline edits survive reloads, and merge (it is a CRDT) when the hub is back
export const local = new IndexeddbPersistence(`tydig:${link ? link.id + ':' : ''}${projName}`, ydoc)

export const user = { name: me.name || me.email,
  color: localStorage.userColor ||= `hsl(${Math.floor(Math.random() * 360)} 70% 45%)` }
export const token = () => /better-auth\.session_token=([^;]+)/.exec(document.cookie)?.[1] || ''
export const ws = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
// connected by main.js, once every module listens
export const provider = new HocuspocusProvider({
  url: `${ws}/sync`, name: projName, document: ydoc, token, connect: false,
  onAuthenticationFailed: () => { alert('Lost access to this project.'); location.search = '' },
})
provider.setAwarenessField('user', { ...user, colorLight: user.color })
provider.on('status', ({ status }) => {
  $('status').dataset.state = status
  $('status').title = $('status').textContent = { connected: 'online', connecting: 'connecting' }[status]
    ?? 'offline (saving locally)'
})

// Text outside build output lives here; anything else is a file on disk.
export const GEN = /^(out|build|figures)\//
export const isImg = p => /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(p)
export const okPath = p => /^[\w./@ -]+$/.test(p) &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
export const setText = (t, s) => ydoc.transact(() => { t.delete(0, t.length); t.insert(0, s) })

// A file's tags, from the project's .gitattributes (server/tags.mjs):
// ai-generated, read-only. Setting one edits that file, so it syncs and is kept.
export { TAGFILE, TAGS }
export const tags = p => tagsOf(files.get(TAGFILE)?.toString(), p)
export const tag = (p, name, on) => {
  const t = files.get(TAGFILE), s = setTag(t?.toString(), p, name, on)
  t ? setText(t, s) : files.set(TAGFILE, new Y.Text(s))
}
// told whenever the tags may have changed
export const onTags = f => files.observeDeep(evs => evs.some(e => e.target === files.get(TAGFILE) ||
  e.keysChanged?.has(TAGFILE)) && f())
