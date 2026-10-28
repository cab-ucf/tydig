// The hub's end of irweb/http/2 (`just test irweb`), as irp's client speaks
// it, through a local relay: every request carries the link's access token.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const { Endpoint, EndpointAddr, RelayMode, SecretKey } =
  await import(createRequire(new URL('../.uitest/package.json', import.meta.url)).resolve('@number0/iroh'))
import { derive, newSeed } from '../server/relay.mjs'
import { check, done, until } from './lib.mjs'

const [, pub, token, relay] = /#(\w{52});t=(\w{64});r=(.+)$/.exec(readFileSync(process.env.LINKFILE, 'utf8').trim())
const seed = readFileSync(process.env.LINKFILE.replace(/link$/, 'link-seed'), 'utf8').trim()
const id = SecretKey.fromBytes([...derive(seed, 'irweb v1 endpoint identity')]).public()
check('the link names the hub without its seed', !readFileSync(process.env.LINKFILE, 'utf8').includes(seed) &&
  newSeed(Buffer.from(id.toBytes())) === pub)
const b = Endpoint.builder(); b.applyMinimal(); b.relayMode(RelayMode.customFromUrls([relay]))
const ep = await b.bind()
const dial = () => ep.connect(new EndpointAddr(id, relay), [...Buffer.from('irweb/http/2')])
const ask = async (conn, head, body = '') => {
  const { send, recv } = await conn.openBi()
  await send.writeAll([...Buffer.from(`${head}\r\nhost: hub\r\ncontent-length: ${body.length}\r\n\r\n${body}`)])
  await send.finish()
  return Buffer.from(await recv.readToEnd(1 << 20)).toString()
}
const access = `irweb-access: ${token}`

let conn
await until(async () => (conn = await dial()), 60_000)
check('with the token, the hub answers', /^HTTP\/1\.\d 200/.test(await ask(conn, `GET /api/auth-config HTTP/1.0\r\n${access}`)))
for (const [what, h] of [['without the token', ''], ['with another', `\r\nirweb-access: ${'0'.repeat(64)}`],
  ['with it in the body alone', '']]) {
  const c = await dial()
  const r = await ask(c, `POST /api/auth/sign-in/email HTTP/1.0${h}`, what.includes('body') ? access : '')
  check(`${what}, 403 and the connection closed`, /^HTTP\/1\.0 403/.test(r) && await Promise.race([c.closed().then(() => true),
    new Promise(ok => setTimeout(ok, 5000, false))]))
}
const tries = []
for (let i = 0; i < 301; i++) tries.push(await ask(await dial(), `POST /api/auth/sign-up/email HTTP/1.0\r\n${access}` +
  '\r\ncontent-type: application/json', JSON.stringify({ email: `x${i}@example.com`, password: 'password123' })))
check('sign-ups and sign-ins over links share one hub-wide cap',
  /^HTTP\/1\.1 400/.test(tries[0]) && /^HTTP\/1\.1 429/.test(tries[300]))
await ep.close()
done()
