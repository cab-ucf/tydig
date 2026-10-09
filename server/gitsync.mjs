// Git remotes as the durable store: GitHub, GitLab, Codeberg, a university
// GitLab, or a bare repo on a NAS. Whoever owns the account provides the
// always-on half of the system, so no tydig server has to stay up. Hubs
// push when they go idle and when they shut down, and pull when they start,
// so a project survives every hub being offline -- and can be revived by a
// plain `git clone` on a machine that has never seen this software.
//
// The problem with several hubs pushing to one remote is conflicts. The fix
// is that no two hubs ever write the same path:
//
//   .collab/crdt/<hubId>.bin   full CRDT state, written ONLY by that hub
//   <working tree>             the human-readable files, derived from the CRDT
//
// Merging is then a union of distinct files, which git does without asking.
// The CRDT is authoritative: after a merge we apply every hub's state to the
// document (Yjs merge is commutative and idempotent, so all hubs converge on
// the same result regardless of order) and re-mirror the working tree from
// it. A conflict in the working tree is therefore never fatal -- we resolve
// it by regenerating from the merged CRDT.
import { existsSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import * as Y from 'yjs'

export function createGitSync({ hocuspocus, dataDir, proj, git, mirror, okName, outside, hubId, log = console.log }) {
  const cfgDir = path.join(dataDir, 'gitsync')
  const cfgPath = p => path.join(cfgDir, `${p}.json`)
  const inFlight = new Map()          // proj -> Promise (one sync at a time)
  const CRDT_DIR = '.collab/crdt'
  const myFile = `${CRDT_DIR}/${hubId()}.bin`
  const intervalMs = Number(process.env.TYDIG_GIT_PUSH_MINUTES || 5) * 60_000

  const cfg = async p => { try { return JSON.parse(await readFile(cfgPath(p), 'utf8')) } catch { return null } }
  const saveCfg = async (p, c) => { await mkdir(cfgDir, { recursive: true }); await writeFile(cfgPath(p), JSON.stringify(c, null, 1), { mode: 0o600 }) }

  // A remote URL may embed a token, so it is never written into the repo and
  // never returned to the browser in full.
  const redact = url => String(url).replace(/\/\/[^/@]*@/, '//***@')
  // Both reach git as arguments: a branch of "--upload-pack=<cmd>" runs <cmd>
  // on this host, and a local path would read any repo the hub can see --
  // other projects included. Local remotes (a mounted NAS, tests) are opt-in.
  const LOCAL = process.env.TYDIG_GIT_LOCAL === '1'
  const check = (url, branch) => {
    if (!(LOCAL ? /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)\S+$/ : /^(https?:\/\/|git@|ssh:\/\/)\S+$/).test(String(url || '')))
      throw new Error(`not a git URL${LOCAL ? '' : ' (local paths need TYDIG_GIT_LOCAL=1 on the hub)'}`)
    if (!/^(?!-)(?!.*\.\.)[\w./-]{1,100}$/.test(String(branch))) throw new Error('bad branch name')
  }

  // A remote on this hub's own network (loopback, private, link-local, cloud
  // metadata) is refused unless TYDIG_GIT_PRIVATE=1: otherwise anyone who may
  // set a remote could make the hub probe hosts only it can reach.
  const PRIVATE = new BlockList()
  for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.168.0.0', 16]]) PRIVATE.addSubnet(a, n, 'ipv4')
  for (const [a, n] of [['::', 127], ['fc00::', 7], ['fe80::', 10]]) PRIVATE.addSubnet(a, n, 'ipv6')
  const hostOf = url => (/^[\w.-]+@([^:/]+):/.exec(url) || /^\w+:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/.exec(url))?.[1]?.replace(/^\[|\]$/g, '')
  async function reachable(url) {
    const host = hostOf(url)
    if (!host || process.env.TYDIG_GIT_PRIVATE === '1') return
    const ips = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => [])
    for (const { address, family } of ips) {
      const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1]
      if (PRIVATE.check(v4 || address, v4 || family === 4 ? 'ipv4' : 'ipv6'))
        throw new Error(`${host} is on this hub's own network; set TYDIG_GIT_PRIVATE=1 on the hub to allow that`)
    }
  }

  async function doc(p) {
    const dc = await hocuspocus.openDirectConnection(p, { gitsync: true })
    return { ydoc: dc.document, close: () => dc.disconnect().catch(() => {}) }
  }

  // Write this hub's CRDT state, then apply every other hub's, so a pull is
  // absorbed even for files nobody has open in a browser.
  async function absorb(p, ydoc) {
    const dir = path.join(proj(p), CRDT_DIR)
    if (!existsSync(dir)) return 0
    let applied = 0
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.bin') || f === `${hubId()}.bin`) continue
      try {
        Y.applyUpdate(ydoc, new Uint8Array(await readFile(path.join(dir, f))), { gitsync: f })
        applied++
      } catch (e) { log(`gitsync: ignoring ${f} (${e.message})`) }
    }
    return applied
  }

  async function writeState(p, ydoc) {
    await mkdir(path.join(proj(p), CRDT_DIR), { recursive: true })
    await writeFile(path.join(proj(p), myFile), Y.encodeStateAsUpdate(ydoc))
  }

  async function syncNow(p, { reason = 'manual' } = {}) {
    if (inFlight.has(p)) return inFlight.get(p)
    const task = (async () => {
      const c = await cfg(p)
      if (!c?.url) return { skipped: 'no remote configured' }
      check(c.url, c.branch || 'main'); await reachable(c.url)
      const { ydoc, close } = await doc(p)
      try {
        // The URL may carry a token, so it is never stored in .git/config,
        // which every build can read: each fetch and push names it instead.
        await git(p, 'remote', 'remove', 'origin').catch(() => {})
        const branch = c.branch || 'main'
        // rename, not re-point HEAD: re-pointing orphans the history on the old branch
        await git(p, 'branch', '-M', branch).catch(() => {})

        // 1. our state + working tree in, committed
        await mirror(p, ydoc)
        await writeState(p, ydoc)
        await git(p, 'add', '-A')
        await git(p, 'commit', '-q', '-m', `tydig sync (${reason})`).catch(() => {})

        // 2. fetch and merge. -X ours keeps our working tree on conflict; the
        //    CRDT files never conflict (one writer each) and are what matters.
        let pulled = 0
        const head = (await git(p, 'rev-parse', 'HEAD')).trim()
        const fetched = await git(p, 'fetch', c.url, branch).then(() => true).catch(() => false)
        if (fetched) {
          // Deliberately NOT --allow-unrelated-histories: pointing a project
          // at a remote that holds a different project should fail loudly,
          // not merge two unrelated trees into a mess. Use "adopt" (create a
          // project from a git URL) to take a remote's history on purpose.
          const merged = await git(p, 'merge', '--no-edit', '-X', 'ours', 'FETCH_HEAD')
            .then(() => true)
            .catch(async e => {
              const unrelated = /unrelated histories|refusing to merge/i.test(e.message)
              log(`gitsync: merge on "${p}" ${unrelated ? 'refused: the remote holds an unrelated history. Create the project from the git URL instead of pointing an existing one at it.' : `needed help (${e.message})`}`)
              if (unrelated) { c.lastError = 'remote holds an unrelated history; create the project from the git URL instead'; await saveCfg(p, c); return false }
              await git(p, 'checkout', '--ours', '.').catch(() => {})
              await git(p, 'add', '-A').catch(() => {})
              await git(p, 'commit', '-q', '--no-edit').catch(() => {})
              return true
            })
          if (merged) {
            pulled = await absorb(p, ydoc)          // CRDT wins
            await outside(p, ydoc, head)            // and edits no hub made join it
            await mirror(p, ydoc)                   // regenerate the working tree
            await writeState(p, ydoc)               // record the merged result
            await git(p, 'add', '-A')
            await git(p, 'commit', '-q', '-m', 'tydig sync (merge)').catch(() => {})
          }
        }

        // 3. push, with provenance and comment notes under this hub's own
        //    namespace (one writer per ref, like the CRDT files)
        let why = ''
        const pushed = await git(p, 'push', c.url, branch, `refs/notes/*:refs/notes/${hubId()}/*`)
          .then(() => true)
          .catch(async e => {
            const l = String(e.stderr || e.message).trim().split('\n')
            why = redact(l.find(x => /denied|refused|rejected|not found|could not|fatal|error/i.test(x)) || l.pop())
            log(`gitsync: push to ${redact(c.url)} failed (${why})`); return false
          })
        c.lastSync = new Date().toISOString()
        // git's own words ("Permission denied (publickey)", "protected branch")
        c.lastError = pushed ? null : `push failed: ${why}`
        await saveCfg(p, c)
        log(`gitsync: "${p}" ${pushed ? 'pushed' : 'push FAILED'}${pulled ? `, absorbed ${pulled} peer state(s)` : ''} (${reason})`)
        return { ok: pushed, pulled, at: c.lastSync, error: c.lastError }
      } finally { close() }
    })().finally(() => inFlight.delete(p))
    inFlight.set(p, task)
    return task
  }

  // First contact: pull an existing project down from a remote.
  async function adopt(p, url, branch) {
    check(url, branch ?? 'main'); await reachable(url)
    branch ??= /refs\/heads\/(\S+)\s+HEAD/.exec(await git(p, 'ls-remote', '--symref', url, 'HEAD').catch(() => ''))?.[1] || 'main'
    check(url, branch)
    await saveCfg(p, { url, branch })
    await git(p, 'fetch', url, branch)
    // Adopt means take the remote's history wholesale, not merge against a
    // local one. Merging unrelated histories makes git treat every file as
    // added-on-both-sides, so -X ours would silently keep our empty/stale
    // copies and later modifications from peers would never land -- new files
    // would appear while edits vanished. Checking the remote branch out makes
    // this hub a descendant of it, so every later merge is a real merge.
    await git(p, 'checkout', '-B', branch, 'FETCH_HEAD')
    // Loading the document absorbs the remote's CRDT states and any text
    // they lack (a repo written by hand, or by git alone).
    const { ydoc, close } = await doc(p)
    try { await mirror(p, ydoc); await writeState(p, ydoc) } finally { close() }
    await git(p, 'add', '-A')
    await git(p, 'commit', '-q', '-m', 'tydig: adopted from git remote').catch(() => {})
    return { ok: true }
  }

  return {
    async status(p) {
      const c = await cfg(p)
      return c ? { configured: true, url: redact(c.url), branch: c.branch || 'main', lastSync: c.lastSync || null, lastError: c.lastError || null, hubId: hubId() } : { configured: false, hubId: hubId() }
    },
    async setRemote(p, url, branch = 'main') {
      if (!okName(p)) throw new Error('bad project name')
      check(url, branch); await reachable(url)
      const c = (await cfg(p)) || {}
      await saveCfg(p, { ...c, url, branch })
      return this.status(p)
    },
    async clearRemote(p) { await saveCfg(p, {}); return { ok: true } },
    syncNow,
    adopt,
    // Push whatever changed, on a timer and on the way out. "Exiting saves
    // progress" is the property that makes a hub disposable.
    start() {
      // every project with a remote, not just edited ones: someone else's
      // push (another hub, an agent) is pulled without anyone typing here
      const t = setInterval(async () => {
        const names = existsSync(cfgDir) ? (await readdir(cfgDir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []
        for (const p of names) if (existsSync(proj(p)) && (await cfg(p))?.url) await syncNow(p, { reason: 'periodic' }).catch(() => {})
      }, intervalMs)
      t.unref?.()
      return t
    },
    async flushAll(reason = 'shutdown') {
      const names = existsSync(cfgDir)
        ? (await readdir(cfgDir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
        : []
      for (const p of names) {
        if (!existsSync(proj(p))) continue
        await syncNow(p, { reason }).catch(e => log(`gitsync: shutdown sync of "${p}" failed (${e.message})`))
      }
    },
  }
}
