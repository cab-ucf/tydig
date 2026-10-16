// The Project Description (15 pages, Results from Prior NSF Support within
// them) and References Cited, for NSF 26-512: its sections 1 to 4 in its own
// words, and 5 for a Flagship, then Broader Impacts, the measures of success
// and prior support. One document, so @citations resolve; `make` cuts it
// where References Cited starts. A grey [prompt] is what reviewers look for.
#import "/lib/nsf.typ": *
#show: nsf
#let P = G.program
#let track = G.mechanism.prefix.split(":").at(1)

#section("description", none, limit: G.limits.description)[
  = 1. Vision and community benefit for dataset enhancement
  #todo[The scientific questions the enhanced datasets open to AI, which could not be asked before;
  the size, breadth and commitment of the communities that benefit; how this relates to existing data
  efforts, and why it is new.]
  #table(columns: (auto, 1fr, auto, auto), stroke: 0.4pt, inset: 4pt,
    [*Dataset*], [*What it holds*], [*Size*], [*Who uses it*],
    ..G.datasets.map(d => ([#d.name], [#d.holds], [#d.size], [#d.community])).flatten())

  = 2. Research plan
  #for (i, a) in G.aims.enumerate() [
    == Aim #(i + 1): #a.title
    #a.summary #todo[The enhancement (feature extraction, metadata generation, integration, augmentation
    or harmonization), how it enables AI-driven work, how it is validated, and who does it.]
  ]
  == Timeline
  #timeline()

  = 3. Dataset governance and integrity
  #todo[How the data are kept secure and intact; who governs them and how decisions are made; how access
  is managed; how the community contributes, and how contributions are checked.]

  = 4. Dataset availability and infrastructure
  #todo[Where the enhanced datasets live and how people find and use them; user engagement and outreach;
  how adoption is measured, and how users' feedback comes back; how they are maintained and sustained
  after the award.]

  #if track == "Flagship" [
    = 5. Flagship Justification
    #todo[A concise summary of the challenges that need more resources than an Impact award.]
  ]

  = Broader Impacts
  #todo[Benefit to society: the people trained in AI use of scientific data, the communities served,
  partnerships; how each is done and assessed.]

  #measures(P.measures)

  #prior()
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: G.at("style", default: "american-chemical-society"))
]
