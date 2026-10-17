// What is optional (spelling, the language server, AI) waits for the first
// live preview, or 15 s, so it never takes the bandwidth or the CPU from it.
// (The preview's compiler, renderer and fonts: typst.worker.js.)
let shown
export const previewed = () => shown()
export const later = Promise.race([new Promise(r => shown = r), new Promise(r => setTimeout(r, 15000))])
