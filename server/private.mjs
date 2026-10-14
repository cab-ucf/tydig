// Everything the hub writes is its own user's alone (imported first).
import { chmodSync } from 'node:fs'
import path from 'node:path'
process.umask(0o077)
try { chmodSync(path.resolve(process.env.TYDIG_DATA || 'data'), 0o700) } catch {}
