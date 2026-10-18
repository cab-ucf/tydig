// Specific Aims, the Research/Project Plan (Significance, Approach, Innovation)
// and the Bibliography in one document, so @citations resolve; `make` cuts it
// into three PDFs. In PeerNet, Specific Aims and the Research Plan are separate
// text boxes (paste the prose of each); the references upload as one PDF.
#import "/lib/fdh.typ": *
#show: fdh

#section("aims", "Specific Aims", limit: G.limits.aims)[
  #lorem(60) @siegel2026

  *Hypothesis.* #lorem(20)

  #for (i, a) in G.aims.enumerate() [
    *Aim #(i + 1). #a.title.* #a.summary \
  ]

  *Impact.* #lorem(30)
]

#section("strategy", "Research/Project Plan", limit: G.limits.strategy)[
  = Significance
  #lorem(100)

  = Approach
  #lorem(120)

  = Innovation
  #lorem(70)
]

#section("references", "Bibliography and References Cited")[
  #bibliography("/refs.bib", title: none, style: "american-medical-association")
]
