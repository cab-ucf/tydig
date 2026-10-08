// Specific Aims (1 page), Research Strategy (6 pages) and References (no
// limit): one document, so @citations resolve, cut into three PDFs by
// `make`. Names, aims and the title come from grant.yaml.
#import "/lib/nih.typ": *
#show: nih

#section("aims", "Specific Aims", limit: G.limits.aims)[
  // The hook: the problem, why it matters, and the gap.
  #lorem(60) @nih2025grants

  // What this project does about it, and why now.
  *The objective* of this #G.mechanism.code is #lorem(25) Our *central
  hypothesis* is #lorem(15)

  #for (i, a) in G.aims.enumerate() [
    *Aim #(i + 1). #a.title.* #a.summary \
  ]

  *Expected outcome:* #lorem(35)
]

#section("strategy", "Research Strategy", limit: G.limits.strategy)[
  = Significance
  #lorem(100)

  = Innovation
  #lorem(80)

  = Approach
  // #G.mechanism.code: #G.mechanism.purpose
  #lorem(60)

  #for (i, a) in G.aims.enumerate() [
    == Aim #(i + 1): #a.title
    *Rationale.* #lorem(50) \
    *Design.* #lorem(70) \
    *Expected results and alternatives.* #lorem(40)
  ]

  == Timeline
  #table(columns: (auto,) + (1fr,) * (G.years * 2), align: center + horizon,
    [*Aim*], ..range(G.years * 2).map(h => [Y#(calc.quo(h, 2) + 1)H#(calc.rem(h, 2) + 1)]),
    ..G.aims.enumerate().map(((i, a)) => ([Aim #(i + 1)],) + range(G.years * 2).map(_ => [■])).flatten())
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: "american-psychological-association")
]
