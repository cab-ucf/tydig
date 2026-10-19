// Replace a Y.Text's content by its changed span alone, so comment anchors
// and concurrent edits elsewhere survive. Never splits a surrogate pair.
// Shared by the hub (store.mjs) and the client (doc.js); no DOM, no node.
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
