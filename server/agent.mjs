// An agent member at work: each @mention in the project goes to Claude Code
// (or TYDIG_AGENT_CMD, given $TYDIG_PROMPT and $TYDIG_MCP), which answers
// through the hub's MCP tools alone.
//   TYDIG_HUB=http://localhost:8080 TYDIG_PROJECT=paper TYDIG_AGENT_TOKEN=tyd_... node agent.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { TYDIG_HUB: hub = 'http://localhost:8080', TYDIG_PROJECT: proj,
  TYDIG_AGENT_TOKEN: token, TYDIG_AGENT_CMD: cmd } = process.env
if (!proj || !token) throw new Error('set TYDIG_PROJECT and TYDIG_AGENT_TOKEN (Share > Agents)')
const url = `${hub}/api/agent/${proj}/mcp`, headers = { authorization: `Bearer ${token}` }
const tool = (name, args = {}) => fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  .then(r => r.json()).then(r => JSON.parse(r.result?.content?.[0]?.text ?? 'null'))
const mcp = path.join(mkdtempSync(path.join(tmpdir(), 'tydig-agent-')), 'mcp.json')
writeFileSync(mcp, JSON.stringify({ mcpServers: { tydig: { type: 'http', url, headers } } }), { mode: 0o600 })

const prompt = t => `You are a member of the tydig project "${proj}", a Typst document people edit live.
${t.from} asked you${t.file ? `, in a comment on ${t.file}${t.quote ? ` about "${t.quote}"` : ''}` : ''}:

${t.text}

Work only through the tydig tools. Read CLAUDE.md first if tydig_files lists it. Make the smallest
edit that does what was asked (tydig_read, then tydig_write the whole file). Finish with tydig_reply,
answers="${t.id}": what you changed, in a sentence or two, or a question. Never invent facts,
citations or results. Never type a reference: find it with tydig_search, add it with tydig_cite.
Asked to check references: tydig_check_refs, then search each claim several ways, read abstracts,
and leave at most one tydig_comment per claim (ten in all) where the collaborators should weigh
something. Do not change their text unless asked.`

const work = t => new Promise(done => {
  const env = { ...process.env, TYDIG_PROMPT: prompt(t), TYDIG_MCP: mcp }
  const p = cmd ? spawn('sh', ['-c', cmd], { env, stdio: 'inherit' })
    : spawn('claude', ['-p', env.TYDIG_PROMPT, '--mcp-config', mcp, '--strict-mcp-config',
      '--allowedTools', 'mcp__tydig'], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  p.on('error', e => done(e.message)).on('close', done)
})

for (;;) {
  for (const t of await tool('tydig_tasks').catch(e => (console.error(e.message), []))) {
    console.log(`${t.from}: ${t.text}`)
    const code = await work(t)
    if ((await tool('tydig_tasks')).some(x => x.id === t.id)) // never asked twice
      await tool('tydig_reply', { answers: t.id, text: `I could not finish this (${cmd || 'claude'}: ${code}). Mention me again to retry.` })
  }
  await new Promise(r => setTimeout(r, 10_000))
}
