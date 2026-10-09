// A .tar.gz, .tar or .zip, read in memory: never extracted to disk, so a
// path out of the project, a symlink or a device file cannot land anywhere.
// Regular files only; a folder everything sits in (corona-r21/) is dropped;
// .git and OS litter are skipped. max bounds the unpacked size (zip bombs).
import zlib from 'node:zlib'

const files = (buf, max) => buf[0] === 0x50 && buf[1] === 0x4b ? zip(buf, max) : tar(buf[0] === 0x1f && buf[1] === 0x8b
  ? zlib.gunzipSync(buf, { maxOutputLength: max }) : buf)

function tar(b) {
  if (b.toString('latin1', 257, 262) !== 'ustar') throw new Error('not a tar, tar.gz or zip archive')
  const out = []
  let long = null
  for (let o = 0; o + 512 <= b.length && b[o]; ) {
    const str = (a, n) => b.toString('utf8', o + a, o + a + n).replace(/\0.*$/s, '')
    const size = parseInt(str(124, 12).trim() || '0', 8), type = str(156, 1) || '0', data = b.subarray(o + 512, o + 512 + size)
    const name = long ?? [str(345, 155), str(0, 100)].filter(Boolean).join('/')
    long = type === 'L' ? data.toString().replace(/\0.*$/s, '') : type === 'x' ? /\d+ path=([^\n]*)\n/.exec(data)?.[1] ?? null : null
    if (type === '0' || type === '7') out.push({ path: name, data })
    o += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

function zip(b, max) {
  const out = [], end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]))
  if (end < 0) throw new Error('not a zip file')
  let total = 0
  for (let i = 0, o = b.readUInt32LE(end + 16); i < b.readUInt16LE(end + 10); i++) {
    const method = b.readUInt16LE(o + 10), csize = b.readUInt32LE(o + 20), size = b.readUInt32LE(o + 24)
    const nl = b.readUInt16LE(o + 28), mode = b.readUInt32LE(o + 38) >>> 16, at = b.readUInt32LE(o + 42)
    const name = b.toString('utf8', o + 46, o + 46 + nl)
    o += 46 + nl + b.readUInt16LE(o + 30) + b.readUInt16LE(o + 32)
    if (name.endsWith('/') || (mode & 0o170000) === 0o120000 || (total += size) > max) continue
    const start = at + 30 + b.readUInt16LE(at + 26) + b.readUInt16LE(at + 28), raw = b.subarray(start, start + csize)
    out.push({ path: name, data: method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: size }) })
  }
  return out
}

export function unpack(buf, max = 2 ** 30) {
  const all = files(buf, max).map(f => ({ ...f, path: f.path.replace(/^\.\/|^\/+/g, '') }))
    .filter(f => !f.path.split('/').some(s => /^(\.git|__MACOSX|\.DS_Store|Thumbs\.db)$/.test(s)))
  const top = all[0]?.path.split('/')[0]
  return all.length && all.every(f => f.path.startsWith(top + '/')) ? all.map(f => ({ ...f, path: f.path.slice(top.length + 1) })) : all
}
