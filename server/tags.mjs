// File tags, kept in the project's .gitattributes as git keeps attributes: a
// pattern, then names (-name unsets one); the last line that matches decides
// each. Git ignores names it does not know, so the tags travel with the
// project, its archives and its clones, and a template can ship them.
//   ai-generated  written by AI: labelled in the tree and over the editor
//   read-only     a reference: the editor will not change it, nor will an agent
// Shared by the client (tree, editor) and the hub (agents); no DOM, no node.
export const FILE = '.gitattributes'
export const TAGS = { 'ai-generated': 'AI-generated', 'read-only': 'read-only' }

// a pattern as git reads it: without a slash it matches a name at any depth;
// * stays within a folder, ** crosses them
const regex = p => {
  const at = p.replace(/^\//, ''), deep = !p.slice(0, -1).includes('/')
  const body = at.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*\*\/|\/\*\*$|\*\*|\*|\?/g, m =>
    ({ '**/': '(?:.*/)?', '/**': '/.*', '**': '.*', '*': '[^/]*', '?': '[^/]' })[m])
  return new RegExp(`^${deep ? '(?:.*/)?' : ''}${body}$`)
}
const quote = p => /\s/.test(p) ? `"${p}"` : p
const lines = text => String(text ?? '').split('\n').map(l => {
  const m = /^\s*("([^"]*)"|\S+)\s*(.*)$/.exec(l)
  return !m || m[1].startsWith('#') ? { l } : { l, pattern: m[2] ?? m[1], names: m[3].split(/\s+/).filter(Boolean) }
})

// the tags a path has: { 'ai-generated': true, ... }
export function tagsOf(text, path) {
  const out = {}
  for (const { pattern, names } of lines(text)) if (pattern && regex(pattern).test(path))
    for (const n of names) { const off = n.startsWith('-') || n.startsWith('!'), k = off ? n.slice(1) : n
      if (k in TAGS) off ? delete out[k] : out[k] = true }
  return out
}

// .gitattributes with one tag set or unset for one path: on its own line for
// that path (made, changed, or dropped when it says nothing any more)
export function setTag(text, path, tag, on) {
  const ls = lines(text), mine = ls.find(x => x.pattern === path)
  const names = (mine?.names ?? []).filter(n => n.replace(/^[-!]/, '') !== tag)
  const inherited = !!tagsOf(ls.filter(x => x !== mine).map(x => x.l).join('\n'), path)[tag]
  if (on !== inherited) names.push(on ? tag : '-' + tag)
  const line = names.length ? `${quote(path)} ${names.join(' ')}` : null
  const out = mine ? ls.flatMap(x => x === mine ? line == null ? [] : [line] : [x.l])
    : [...ls.map(x => x.l).filter((l, i, a) => l || i < a.length - 1), ...line ? [line] : []]
  return out.join('\n').replace(/\n*$/, '\n')
}
