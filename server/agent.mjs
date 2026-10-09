// An agent member at work: waits for @mentions in a tydig project and hands
// each to Claude Code, which answers through agent-mcp.mjs's tools only (no
// shell, no local files). Another agent: TYDIG_AGENT_CMD, a shell command
// that gets the task in $TYDIG_PROMPT and the MCP config path in $TYDIG_MCP.
//   TYDIG_HUB=http://localhost:8080 TYDIG_PROJECT=paper TYDIG_AGENT_TOKEN=tyd_... node agent.mjs
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { TYDIG_HUB: hub = 'http://localhost:8080', TYDIG_PROJECT: proj, TYDIG_AGENT_TOKEN: token, TYDIG_AGENT_CMD: cmd } = process.env
if (!proj || !token) { console.error('set TYDIG_PROJECT and TYDIG_AGENT_TOKEN (Share > Agents makes one)'); process.exit(1) }
const call = (method, p, body) => fetch(`${hub}/api/agent/${proj}${p}`, { method, body: body && JSON.stringify(body),
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }).then(r => r.json())

const mcp = path.join(mkdtempSync(path.join(tmpdir(), 'tydig-agent-')), 'mcp.json')
writeFileSync(mcp, JSON.stringify({ mcpServers: { tydig: { command: process.execPath,
  args: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-mcp.mjs')], env: { TYDIG_HUB: hub, TYDIG_PROJECT: proj, TYDIG_AGENT_TOKEN: token } } } }), { mode: 0o600 })
const TOOLS = ['tasks', 'files', 'read', 'write', 'reply', 'comment', 'search', 'cite', 'check_refs'].map(t => `mcp__tydig__tydig_${t}`).join(',')

const prompt = (me, t) => `You are @${me}, a member of the tydig project "${proj}", a Typst document people are editing live.
${t.from} asked you${t.file ? `, in a comment on ${t.file}${t.quote ? ` about the text "${t.quote}"` : ''}` : ''}:

${t.text}

Work only through the tydig tools. Read CLAUDE.md first if tydig_files lists it, then read what you need,
and make the smallest edit that does what was asked (tydig_read, then tydig_write the whole file).
Finish by calling tydig_reply with answers="${t.id}": what you changed, in a sentence or two, or a question if the
request is unclear. Do not invent facts, citations or results.

References: never type one. Find papers with tydig_search and add them only with tydig_cite (the registrar's record).
Asked to check, review or find references: run tydig_check_refs, then for each claim that cites, or needs, a paper,
search it at least three ways (its own words; technical or MeSH terms; the opposite finding; "review" or
"meta-analysis"), in every index, and read the abstracts. Where the search turns up something the collaborators
should weigh (evidence against the claim, a stronger or newer source, a reference that does not match its record or
does not say what the sentence claims, a claim with nothing behind it), leave one tydig_comment on that sentence,
naming the papers (title, year, DOI): at most one a claim and ten in all. Do not change their text unless asked.`

const run = (me, t) => new Promise(done => {
  const env = { ...process.env, TYDIG_PROMPT: prompt(me, t), TYDIG_MCP: mcp }
  const p = cmd ? spawn('sh', ['-c', cmd], { env, stdio: 'inherit' })
    : spawn('claude', ['-p', env.TYDIG_PROMPT, '--mcp-config', mcp, '--strict-mcp-config', '--allowedTools', TOOLS], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  p.on('error', e => done(e.message)); p.on('close', code => done(code))
})

for (;;) {
  const { agent: me, tasks = [], error } = await call('GET', '/tasks').catch(e => ({ error: e.message }))
  if (error) console.error(`hub: ${error}`)
  for (const t of tasks) {
    console.log(`@${me}: ${t.from}: ${t.text}`)
    const code = await run(me, t)
    // never ask the same thing twice: an unanswered run says so
    if ((await call('GET', '/tasks')).tasks?.some(x => x.id === t.id))
      await call('POST', '/say', { answers: t.id, text: `I could not finish this (${cmd || 'claude'} ended: ${code}). Mention me again to retry.` })
  }
  await new Promise(r => setTimeout(r, 10_000))
}
