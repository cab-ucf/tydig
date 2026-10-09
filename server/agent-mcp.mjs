// An MCP server (stdio) that lets Claude Code, or any MCP client, work on one
// tydig project as an agent member: read and edit its text live, see where
// it is @mentioned, and answer in the Discussion.
//   TYDIG_HUB=http://localhost:8080 TYDIG_PROJECT=paper TYDIG_AGENT_TOKEN=tyd_... node agent-mcp.mjs
// MCP over stdio is JSON-RPC, a message per line; only what tools need is here.
const { TYDIG_HUB: hub = 'http://localhost:8080', TYDIG_PROJECT: proj, TYDIG_AGENT_TOKEN: token } = process.env
const call = async (method, p, body) => {
  const r = await fetch(`${hub}/api/agent/${proj}${p}`, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j
}
const read = new Map() // path -> the text as read: the base a write is merged from
const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const tools = {
  tydig_tasks: { description: 'Where people @mentioned you and you have not yet answered: id, who, what they ask, and the file and quoted text a comment is on.',
    props: {}, run: () => call('GET', '/tasks') },
  tydig_files: { description: "The project's text files.", props: {}, run: () => call('GET', '/files') },
  tydig_read: { description: 'Read a text file, as it is now in everyone\'s editor.', props: { path: str('e.g. main.typ') },
    run: async ({ path }) => { const f = await call('GET', `/file?path=${encodeURIComponent(path)}`); read.set(path, f.text); return f.text } },
  tydig_write: { description: 'Replace a text file with your edited version. Read it first: your change is merged with what people typed since, live in their editors. A new path creates the file.',
    props: { path: str('the file'), text: str('its whole new content') },
    run: ({ path, text }) => call('PUT', '/file', { path, text, base: read.get(path) }).then(r => (read.set(path, text), r)) },
  tydig_reply: { description: 'Post in the Discussion. Set answers to the task id you are answering (it is then done, and the reply joins that comment\'s thread); leave it out to write to everyone.',
    props: { text: str('what you did, or a question'), answers: str('task id') }, required: ['text'],
    run: ({ text, answers }) => call('POST', '/say', { text, answers }) },
}
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...result }) + '\n')
let buf = ''
process.stdin.on('data', async d => {
  buf += d; let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    const { id, method, params } = JSON.parse(line)
    if (id === undefined) continue // a notification
    if (method === 'initialize') reply(id, { result: { protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'tydig', version: '1' } } })
    else if (method === 'tools/list') reply(id, { result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description,
      inputSchema: { type: 'object', properties: t.props, required: t.required ?? Object.keys(t.props) } })) } })
    else if (method === 'tools/call') {
      const out = await Promise.resolve(tools[params.name]?.run(params.arguments || {}))
        .then(r => ({ text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }), e => ({ text: String(e.message || e), isError: true }))
      reply(id, { result: { content: [{ type: 'text', text: out.text }], isError: !!out.isError } })
    } else if (method === 'ping') reply(id, { result: {} })
    else reply(id, { error: { code: -32601, message: `no method ${method}` } })
  }
})
