// One-time move of an older hub's layout into DATA/.hub/<project>/.
// Safe to delete once every hub has run it. A folder of those names that
// holds .git is a project (gitsync, agents...), never an older hub's: left be.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export function migrate(DATA, HUB) {
  const old = d => (d = path.resolve(DATA, d), existsSync(path.join(d, '.git')) ? null : d)
  const move = (from, n, to) => {
    mkdirSync(path.join(HUB, n), { recursive: true })
    renameSync(from, path.join(HUB, n, to))
  }
  const ls = d => d && existsSync(d) ? readdirSync(d).map(f => [path.join(d, f), f]) : []
  const g = old('gitsync'), a = old('agents')
  for (const [f, n] of ls(g && path.join(g, 'keys')))
    move(f, n.replace(/\.pub$/, ''), n.endsWith('.pub') ? 'key.pub' : 'key')
  for (const [f, n] of ls(g)) if (n.endsWith('.json')) move(f, n.slice(0, -5), 'remote.json')
  for (const [f, n] of ls(a)) if (n.endsWith('.json')) move(f, n.slice(0, -5), 'agents.json')
  for (const f of [g && path.join(g, 'known_hosts'), path.join(HUB, 'known_hosts')])
    if (f && statSync(f, { throwIfNoEntry: false })?.isFile()) renameSync(f, path.join(HUB, '.known_hosts'))
  for (const d of ['gitsync', 'agents', 'federation', 'iroh.secret', 'iroh.json'].map(old)) if (d) rmSync(d, { recursive: true, force: true })
}
