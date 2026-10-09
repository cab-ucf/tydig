// The public internet only: a name resolves to addresses that are not this
// machine's own network (loopback, private, CGNAT, link-local and cloud
// metadata, ULA, or v4 hidden in v6). Throws otherwise.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const NO = new BlockList()
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) NO.addSubnet(a, n, 'ipv4')
for (const [a, n] of [['::', 127], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]])
  NO.addSubnet(a, n, 'ipv6')

export async function publicOnly(host) {
  const ips = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => [])
  if (!ips.length) throw new Error(`${host} does not resolve`)
  for (const { address, family } of ips) {
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
    if (NO.check(v4 || address, v4 || family === 4 ? 'ipv4' : 'ipv6')) throw new Error(`${host} is on this hub's own network`)
  }
  return ips
}
