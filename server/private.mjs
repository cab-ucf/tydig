// Everything the hub creates is readable by its own user alone: auth.db holds
// password hashes and live sessions, and DATA/ holds every project and key.
// Run first (index.mjs imports it before anything opens a file).
import { chmodSync, readdirSync } from 'node:fs'
import path from 'node:path'
process.umask(0o077)
const DATA = path.resolve(process.env.TYDIG_DATA || 'data')
// and what earlier versions left readable
try { chmodSync(DATA, 0o700); for (const f of readdirSync(DATA)) if (/^(auth\.db.*|link)$/.test(f)) chmodSync(path.join(DATA, f), 0o600) } catch {}
