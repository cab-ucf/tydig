// The Concept Outline (PAPPG 24-1 II.F.1, I.D.1): a planning proposal's
// first step, two pages, emailed with note.typ and not uploaded. The program
// officer's approving email is what lets the proposal be submitted: upload
// it as the Planning – Program Officer Concurrence Email.
#import "/lib/nsf.typ": *
#import "/lib/budget.typ": budget, money, sum
#show: nsf
#let P = G.program

#section("concept", "Concept Outline", limit: 2)[
  *#G.title* \
  #G.investigators.map(p => [#name(p), #p.title]).join("; "), #G.institution.department,
  #G.institution.name. A planning proposal (PAPPG II.F.1) to #P.name (#P.contact);
  NSF units: #P.units.join(", "). *Keywords:* #G.keywords.join("; ").

  = Vision
  #todo[The question the enhanced datasets will let AI answer, which no one can ask today, and for whom.]

  = Existing datasets to enhance (no new collection)
  #table(columns: (auto, 1fr, auto, auto), stroke: 0.4pt, inset: 4pt,
    [*Dataset*], [*What it holds*], [*Size*], [*Who uses it*],
    ..G.datasets.map(d => ([#d.name], [#d.holds], [#d.size], [#d.community])).flatten())

  = Why a planning grant
  #todo[What is missing that planning produces (evidence, an agreed schema, governance), and the
  Impact or Flagship proposal it leads to.]

  = Planning activities
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]

  = Governance, availability and infrastructure
  #todo[Who governs the data, how access is managed, where they will live, and how NAIRR or an NSF
  data platform serves them.]

  = Foundation
  #todo[The team's prior datasets and tools this builds on, and why they can do it.]

  = Request and measures
  About #money(sum(budget.total)) over #G.years years, indirect costs included.

  #todo[The measures of success this advances (program.measures in grant.yaml), and how each is counted.]
]
