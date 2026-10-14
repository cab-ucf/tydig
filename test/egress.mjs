// The build network's way out: public HTTPS, and nothing on this side of it.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { publicOnly } from '../server/public.mjs'
import { check, done } from './lib.mjs'

const eg = spawn(process.execPath, [new URL('../server/egress.mjs', import.meta.url).pathname],
  { env: { ...process.env, TYDIG_EGRESS_PORT: '3129' }, stdio: 'ignore' })
await new Promise(r => setTimeout(r, 600))
const say = line => new Promise(ok => {
  let out = ''
  const s = net.connect(3129, '127.0.0.1', () => s.write(line)).on('data', d => { out += d; s.destroy() }).on('close', () => ok(out))
})
for (const to of ['127.0.0.1:443', 'localhost:443', '10.0.0.1:443', '192.168.1.1:443', '172.20.0.1:443', '100.100.100.100:443',
  '169.254.169.254:443', '[::1]:443', '[fd00::1]:443', '[::ffff:10.0.0.1]:443', '[64:ff9b::a00:1]:443', '8.8.8.8:22'])
  check(`refused: ${to}`, (await say(`CONNECT ${to} HTTP/1.1\r\nHost: ${to}\r\n\r\n`)).startsWith('HTTP/1.1 403'))
check('plain HTTP is not proxied', (await say('GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n')).startsWith('HTTP/1.1 405'))
check('a public address passes the check', (await publicOnly('8.8.8.8'))[0].address === '8.8.8.8')
eg.kill()
done()
