// tydig's client. Where each feature lives:
//   util.js      helpers, settings, the session, the hub's API
//   doc.js       the shared document (Yjs): offline copy, sync, who is here
//   editor.js    CodeMirror: syntax, themes, LSP, surprise overlay; opening files
//   ghost.js     ghost text, from the hub's model or Ollama on this machine
//   comments.js  comments and their anchors, the Discussion; preview -> source
//   preview.js   typst in the browser: preview, pins, missing files, PDF, zoom
//   tree.js      file tree, uploads, archives, new, rename, delete, quick open
//   panels.js    side panel: history and checkpoints, build, checklist,
//                template switch, changes made while away
//   dialogs.js   projects, sharing (members, invites, agents), git remote
//   menu.js      menubar actions, layout
//   keys.js      keys: Mod-, vim's leader and ex commands, the list
//   auth.js (sign-in, account), link.js (a hub reached by its link),
//   cite.js (citations), spell.js (spelling and grammar), surprise.js
//   (surprise engine), prov.js (signing)
// The feature modules import one another: at load, each may call only the
// others' function declarations (hoisted), never their consts.
import { rest } from './link.js' // first: patches fetch and WebSocket in link mode
import { $, settings, projName, me } from './util.js'
import { files, provider, user, local } from './doc.js'
import { path, openFile, restLsp } from './editor.js'
import { renderMains, start } from './preview.js'
import { refreshDisk } from './tree.js'
import { openSidebar } from './panels.js'
import { renderProjects } from './dialogs.js'
import { applyLayout } from './menu.js'
import './keys.js'

$('projname').textContent = projName
// who this is: the address in Settings (the others are in the bar)
$('whoami').textContent = `Signed in as ${me.name} (${me.email})`
applyLayout()
if (settings.sideOpen) openSidebar('comments')
renderProjects()
provider.on('synced', () => {
  refreshDisk().finally(start); renderMains()
  const last = localStorage['last:' + projName]
  const first = files.has(last) ? last : files.has('main.typ') ? 'main.typ'
    : [...files.keys()].sort().find(p => p.endsWith('.typ'))
  if (!path && first) openFile(first)
})
Promise.race([local.whenSynced, new Promise(r => setTimeout(r, 3000))]).then(() => provider.connect())
// Out of sight a little while (or frozen), the page goes quiet: the sync,
// with the presence it renews every 15 s, tinymist and a link's iroh
// endpoint close, so nothing keeps a radio awake. Back in sight, all connect
// again and the CRDT merges what changed meanwhile. (Mentions reach phones
// through irch, which irpush wakes.)
let quiet = false, soon
const hush = () => {
  if (quiet) return
  quiet = true; provider.disconnect(); provider.configuration.websocketProvider.disconnect()
  restLsp(true); rest()
}
document.addEventListener('freeze', hush)
document.addEventListener('visibilitychange', () => {
  clearTimeout(soon)
  if (document.hidden) soon = setTimeout(hush, 15e3)
  else if (quiet) { quiet = false; provider.connect(); restLsp(false) }
})
