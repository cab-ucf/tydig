// Section 14 Q3: Work and Evaluation Plan (Exhibit A), uploaded as one PDF.
// Everything comes from grant.yaml (workplan:), so milestones, parties and
// dates are written once. One table per year of strategies and activities.
#import "/lib/fdh.typ": *
#show: fdh
#set page(margin: 0.75in)
#let W = G.workplan

#align(center)[#text(13pt, weight: "bold")[Work and Evaluation Plan] \
  #text(10pt)[#G.title]]
#v(0.5em)

#grid(columns: (auto, 1fr), row-gutter: 4pt, column-gutter: 8pt,
  [*Project Lead:*], name(pi),
  [*Co-Investigators:*], G.investigators.slice(1).map(name).join("; "),
  [*Institution:*], G.institution.name,
  [*Total Funding:*], "$" + str(G.funding),
  [*Project Period:*], W.period)
#v(0.6em)
#text(weight: "bold")[Project Summary.] W.summary
#v(0.4em)
#text(weight: "bold")[Primary Goal.] W.goal

= Specific Objectives
#for (i, o) in W.objectives.enumerate() [+ #o
]

#let plan(s) = table(columns: (1.6fr, 1.6fr, 1fr, 0.8fr), inset: 5pt, stroke: 0.4pt,
  align: (left, left, left, left),
  table.header([*Strategy / Activity*], [*Process measure*], [*Responsible*], [*By*]),
  ..s.activities.map(a => (a.label, a.measure, a.party, a.date)).flatten())

#for y in W.years [
  == Year #y.year
  #for s in y.strategies [
    #text(weight: "bold")[Strategy: #s.title]
    #plan(s)
    #v(0.4em)
  ]
]
