// What the surprise overlay scores of a .typ file (client/src/surprise.js):
// its prose, wherever it is written, and never its code or markup.
import { prose } from '../client/src/surprise.js'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let pass = true
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); pass &&= c }
const src = `#import "lib/grant.typ": *
#show: doc.with(title: "Thermal relaxation of a water sample", font: "New Computer Modern")
#let R = json("build/results.json")

= Specific Aims
Water cools *fast* when #emph[left alone] in air, at #R.k per minute.
See @fig-a and $x^2$ // a comment
#todo("explain why the rate matters here")
#section("Approach", limit: 2)[
  - First, we measure the rate.
]
#if R.ok [It worked.] else [It did not work.]
A \\# hash, a <label>, a~tie.

New paragraph.
#figure(image("fig.png"), caption: [The cooling curve.])
`
const { text, at } = prose(src), has = s => text.includes(s)
check('text in strings, content blocks, headings and list items is prose', has('Thermal relaxation of a water sample\n') &&
  has('Specific Aims\n') && has('when left alone in air') && has('\nexplain why the rate matters here\n') &&
  has('Approach\n') && has('First, we measure the rate.') && has('The cooling curve.'))
check('code, paths, font names, math, references, labels and comments are not', !/json|results|fig\.png|grant|Computer|x\^2|@|label|comment|\*/.test(text))
check('an #if\'s branches, a heading and a paragraph each end where they end', has('It worked.\nIt did not work.') && has('tie.\nNew paragraph.'))
check('escapes and ties read as what they typeset, with no doubled spaces', has('A # hash, a , a tie.') && !/ {2}/.test(text))
const ok = (s, p) => [...p.text].every((c, k) => /\s/.test(c) || s[p.at[k]] === c)
const files = execFileSync('git', ['ls-files', '*.typ']).toString().trim().split('\n')
check(`each prose character stands for its own source character (here and in ${files.length} .typ files)`,
  ok(src, { text, at }) && files.every(f => ok(readFileSync(f, 'utf8'), prose(readFileSync(f, 'utf8')))))
const big = readFileSync(files[0], 'utf8').repeat(2000), t = performance.now(); prose(big)
check(`fast enough for every keystroke (${(big.length / 1e6).toFixed(1)} MB in ${Math.round(performance.now() - t)} ms)`, performance.now() - t < 1500)

console.log(pass ? '\nPROSE ALL PASS' : '\nPROSE FAILURES')
process.exit(pass ? 0 : 1)
