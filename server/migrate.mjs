// One-time move of an older hub's layout into DATA/.hub/<project>/.
// Safe to delete once every hub has run it.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export function migrate(DATA, HUB) {
  const move = (from, n, to) => {
    mkdirSync(path.join(HUB, n), { recursive: true })
    renameSync(from, path.join(HUB, n, to))
  }
  const ls = d => existsSync(d) ? readdirSync(d).map(f => [path.join(d, f), f]) : []
  const g = path.join(DATA, 'gitsync'), a = path.join(DATA, 'agents')
  for (const [f, n] of ls(path.join(g, 'keys')))
    move(f, n.replace(/\.pub$/, ''), n.endsWith('.pub') ? 'key.pub' : 'key')
  for (const [f, n] of ls(g)) if (n.endsWith('.json')) move(f, n.slice(0, -5), 'remote.json')
  for (const [f, n] of ls(a)) if (n.endsWith('.json')) move(f, n.slice(0, -5), 'agents.json')
  for (const f of [path.join(g, 'known_hosts'), path.join(HUB, 'known_hosts')])
    if (statSync(f, { throwIfNoEntry: false })?.isFile()) renameSync(f, path.join(HUB, '.known_hosts'))
  for (const d of [g, a, 'federation', 'iroh.secret', 'iroh.json']) rmSync(path.resolve(DATA, d), { recursive: true, force: true })
}
