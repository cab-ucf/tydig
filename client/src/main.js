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
//   menu.js      menubar actions, shortcuts, layout
//   auth.js (sign-in, account), link.js (a hub reached by its link),
//   cite.js (citations), spell.js (spelling and grammar), surprise.js
//   (surprise engine), prov.js (signing)
// The feature modules import one another: at load, each may call only the
// others' function declarations (hoisted), never their consts.
import './link.js' // first: patches fetch and WebSocket in link mode
import { $, settings, projName } from './util.js'
import { files, provider } from './doc.js'
import { path, openFile } from './editor.js'
import { renderMains, scheduleCompile } from './preview.js'
import { refreshDisk } from './tree.js'
import { openSidebar } from './panels.js'
import { renderProjects } from './dialogs.js'
import { applyLayout } from './menu.js'

$('projname').textContent = projName
applyLayout()
if (settings.sideOpen) openSidebar('comments')
renderProjects()
provider.on('synced', () => {
  refreshDisk(); renderMains()
  const last = localStorage['last:' + projName]
  const first = files.has(last) ? last : files.has('main.typ') ? 'main.typ'
    : [...files.keys()].sort().find(p => p.endsWith('.typ'))
  if (!path && first) openFile(first)
  scheduleCompile()
})
provider.connect()
