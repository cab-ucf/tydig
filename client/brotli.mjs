// The built assets, each beside a brotli copy at its best (the hub serves it
// to a browser that takes br): the compiler a third smaller than gzip makes
// it. Slow (minutes), so the image build runs it, not every build.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { brotliCompress, constants as Z } from 'node:zlib'
import { promisify } from 'node:util'

const dir = new URL('dist/assets/', import.meta.url), br = promisify(brotliCompress)
await Promise.all((await readdir(dir)).filter(f => /\.(js|css|wasm|svg|otf|ttf)$/.test(f)).map(async f => {
  const b = await readFile(new URL(f, dir))
  if (b.length > 1024) await writeFile(new URL(f + '.br', dir), await br(b, { params: {
    [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }))
}))
