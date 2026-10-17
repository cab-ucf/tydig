// Each suite against fresh hubs with data of their own:
//   node test/run.mjs [suite...]   (default: all but ui, link, lsp, sandbox)
// ui and link need puppeteer (installed into .uitest/), link an iroh-relay
// on PATH, lsp tinymist, sandbox rootless podman.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const HUBLESS = ['prose', 'egress', 'sandbox']
const ENV = {
  signup: { TYDIG_SIGNUP: 'invite' },
  agent: { TYDIG_CROSSREF: 'http://localhost:3999/works', TYDIG_PUBMED: 'http://localhost:3999/eutils',
    TYDIG_OPENALEX: 'http://localhost:3999/oa', OPENALEX_API_KEY: 'k' },
  assist: { TYDIG_OLLAMA: 'http://127.0.0.1:11500', TYDIG_GHOST_MODEL: 'fake', TYDIG_PERPLEXISCOPE: 'http://127.0.0.1:8766' },
  remote: { TYDIG_GIT_LOCAL: '1' },
  link: { TYDIG_LINK: '1', TYDIG_PAGE: 'http://localhost:8099/app/', TYDIG_LINK_RELAY: 'http://localhost:3340' },
}
const ALL = ['prose', 'egress', 'core', 'auth', 'signup', 'offline', 'prov', 'agent', 'template', 'import', 'assist', 'remote']
const suites = process.argv.length > 2 ? process.argv.slice(2) : ALL
const sh = c => execSync(c, { cwd: root, stdio: 'inherit' })
const bg = [] // what to stop after a suite

async function hub(dir, port, env) {
  mkdirSync(dir, { recursive: true })
  const log = openSync(path.join(dir, 'hub.log'), 'w'), url = `http://localhost:${port}`
  bg.push(spawn(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: dir, stdio: ['ignore', log, log],
    env: { ...process.env, PORT: port, TYDIG_DATA: path.join(dir, 'data'), TYDIG_URL: url, TYDIG_ORIGINS: '',
      TYDIG_LINK: '0', TYDIG_SIGNUP: 'open', TYDIG_UNSAFE_BUILDS: '1', ...env } }))
  for (let i = 0; i < 60 && !await fetch(`${url}/api/auth-config`).then(r => r.ok, () => false); i++)
    await new Promise(r => setTimeout(r, 250))
  return url
}

if (suites.some(s => !HUBLESS.includes(s))) execSync('npm run build', { cwd: root, stdio: 'pipe' })
if (suites.some(s => ['ui', 'link'].includes(s)) && !existsSync(path.join(root, '.uitest/node_modules/puppeteer')))
  sh('npm i --prefix .uitest --no-audit --no-fund puppeteer')
let failed = 0
for (const s of suites) {
  const dir = mkdtempSync(path.join(tmpdir(), `tydig-${s}-`)), env = { ...ENV[s] }
  console.log(`--- ${s}`)
  if (s === 'link') {
    mkdirSync(path.join(dir, 'site')); symlinkSync(path.join(root, 'client/dist'), path.join(dir, 'site/app'))
    writeFileSync(path.join(dir, 'relay.toml'), 'enable_metrics = false\nhttp_bind_addr = "127.0.0.1:3340"\n')
    bg.push(spawn('iroh-relay', ['--dev', '--config-path', path.join(dir, 'relay.toml')], { stdio: 'ignore' }),
      spawn('python3', ['-m', 'http.server', '8099', '--directory', path.join(dir, 'site')], { stdio: 'ignore' }))
    Object.assign(env, { LINKFILE: path.join(dir, 'data/link'), DATA: path.join(dir, 'data') })
  }
  if (s === 'remote') {
    execSync(`git init -q --bare -b main ${dir}/remote.git`)
    Object.assign(env, { REMOTE: `${dir}/remote.git`, DATA_A: `${dir}/a/data`, DATA_B: `${dir}/b/data`,
      HUB_A: await hub(`${dir}/a`, 3100, env), HUB_B: await hub(`${dir}/b`, 3200, env) })
  } else if (!HUBLESS.includes(s)) env.HUB = await hub(dir, 3000, env)
  const code = await new Promise(ok => spawn(process.execPath, [path.join(root, `test/${s}.mjs`)],
    { cwd: HUBLESS.includes(s) ? root : dir, stdio: 'inherit', env: { ...process.env, ...env } }).on('close', ok))
  await Promise.all(bg.splice(0).map(p => new Promise(ok => p.exitCode !== null || p.signalCode !== null ? ok() : (p.on('exit', ok), p.kill()))))
  if (code) { failed++; console.log(`FAILED: ${s} (hub log in ${dir})`) } else rmSync(dir, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed')
process.exit(failed ? 1 : 0)
