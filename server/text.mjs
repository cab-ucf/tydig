// A project's text, as the hub (store.mjs) and the client (doc.js) both read
// it: which paths it may hold, what is build output (disk only), what counts
// as text, and how a Y.Text takes a new version. No DOM, no node.
export const GEN = /^(out|build|figures)\//
export const okPath = p => typeof p === 'string' && p.length < 256 && /^[\w./@ -]+$/.test(p) &&
  p.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(git|collab)$/i.test(s))
export const editable = p => okPath(p) && !GEN.test(p)
// text: UTF-8, no NUL, under 1 MB, whatever the name
const utf8 = new TextDecoder('utf-8', { fatal: true })
export const textOf = b => {
  if (b.length >= 1e6 || b.includes(0)) return null
  try { return utf8.decode(b) } catch { return null }
}

// Replace a Y.Text's content by its changed span alone, so comment anchors
// and concurrent edits elsewhere survive. Never splits a surrogate pair.
export function setText(t, s) {
  const o = t.toString(), hi = i => (o.charCodeAt(i) & 0xFC00) === 0xD800
  if (o === s) return
  let a = 0, b = 0
  while (a < o.length && o[a] === s[a]) a++
  if (a && hi(a - 1)) a--
  while (b < o.length - a && b < s.length - a && o.at(-1 - b) === s.at(-1 - b)) b++
  if (b && hi(o.length - b - 1)) b--
  t.doc.transact(() => { t.delete(a, o.length - a - b); t.insert(a, s.slice(a, s.length - b)) })
}
