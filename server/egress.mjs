// The build network's only way out: an HTTPS proxy (CONNECT to port 443) to
// the public internet. Builds can fetch packages and data; they cannot reach
// the host, the LAN, the campus network or the cloud's metadata service.
// The address checked is the address dialled, so DNS cannot be rebound.
import http from 'node:http'
import net from 'node:net'
import { publicOnly } from './public.mjs'

const srv = http.createServer((req, res) => res.writeHead(405).end('HTTPS only (CONNECT)\n'))
srv.on('connect', async (req, sock, head) => {
  sock.on('error', () => {})
  const [, host, port] = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url) || []
  const ips = port === '443' && await publicOnly(host).catch(() => null)
  if (!ips) return sock.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  const up = net.connect(443, ips[0].address, () => {
    sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head)
    up.pipe(sock).pipe(up)
  })
  up.on('error', () => sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
  sock.on('close', () => up.destroy())
})
srv.listen(Number(process.env.TYDIG_EGRESS_PORT || 3128), () => console.log('egress: public HTTPS only, on', srv.address().port))
