// NSF format (PAPPG 24-1, II.C.2): letter paper, margins of at least 1 in
// with nothing in them, Arial 10 pt or more (Liberation Sans is its metric
// twin, so pages count the same), at most 6 lines per inch (0.55 em leading
// is about 5.3), no page numbers: Research.gov paginates.
#import "/lib/grant.typ": *

#let nsf(body) = {
  set page("us-letter", margin: 1in, numbering: none)
  // a title the program asks to begin a set way (EAGER:, GOALI:, AIDatasets:Impact:)
  let pre = G.mechanism.at("prefix", default: none)
  if pre != none and not G.title.starts-with(pre) {
    place(top + left, dy: -0.4in, box(fill: red, inset: 4pt, text(white, 9pt, weight: "bold")[
      The title must begin "#pre" (grant.yaml)]))
  }
  set text(font: ("Arial", "Liberation Sans"), size: 11pt)
  set par(justify: true, leading: 0.55em, spacing: 0.8em)
  show heading.where(level: 1): set text(12pt)
  show heading: set text(11pt)
  show heading.where(level: 1): set block(above: 1.1em, below: 0.5em)
  show table: set text(10pt)
  show table: set par(justify: false)
  show figure.caption: set text(9.5pt)
  body
}

// The program's measures of success (program.measures in grant.yaml), each
// with this project's target, reported each year.
#let measures(ms) = [
  = Measures of success
  #table(columns: (auto, 1fr), stroke: 0.4pt, inset: 4pt, [*Measure*], [*This project*],
    ..ms.map(m => ([#m], todo[target, reported each year])).flatten())
]

// Results from Prior NSF Support (PAPPG II.D.2.d(iii)), at most 5 of the
// Project Description's pages: each PI and co-PI with an NSF award in the
// past five years, the most closely related one (prior: in grant.yaml).
#let prior() = [
  = Results from Prior NSF Support
  #let ps = G.investigators.filter(p => p.at("prior", default: none) != none)
  #if ps.len() == 0 [No PI or co-PI has received NSF support in the past five years.]
  #for p in ps [
    *#name(p).* (a) #p.prior.award, #p.prior.amount, #p.prior.period. (b) #p.prior.title.
    (c) *Intellectual Merit:* #todo[results]. *Broader Impacts:* #todo[results].
    (d) *Publications:* #todo[complete citations, or "No publications were produced under this award."]
    (e) *Research products and their availability:* #todo[data, software, samples].
    (f) #p.prior.at("renewal", default: [Not a renewal.]) \
  ]
]
