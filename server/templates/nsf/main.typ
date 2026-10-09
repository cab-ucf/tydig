// The Project Description (15 pages, Results from Prior NSF Support within
// them) and References Cited: one document, so @citations resolve, cut where
// References Cited starts by `make`. Facts come from grant.yaml; program:
// there adds the sections a program asks for (GOALI, instrument development,
// measures of success). A grey [prompt] is what reviewers look for there.
#import "/lib/nsf.typ": *
#show: nsf
#let P = G.program

#section("description", none, limit: G.limits.description)[
  = Overview and objectives
  #todo[The problem, why it matters to the field, and what this project will establish @pappg.]
  #for (i, a) in G.aims.enumerate() [*Aim #(i + 1). #a.title.* #a.summary \ ]

  = Background and relation to prior work
  #todo[The state of the art, and the gap this work fills.]

  = Preliminary results
  #todo[What shows this can work. Label simulated figures as simulations.]

  = Research plan
  #for (i, a) in G.aims.enumerate() [
    == Aim #(i + 1): #a.title
    #todo[Approach, expected results, risks and alternatives; who does it.]
  ]

  #if P.at("instrument", default: false) [
    = Development timeline
  ] else [
    == Timeline
  ]
  #table(columns: (auto,) + (1fr,) * (G.years * 2), align: center + horizon,
    [*Aim*], ..range(G.years * 2).map(h => [Y#(calc.quo(h, 2) + 1)H#(calc.rem(h, 2) + 1)]),
    ..G.aims.enumerate().map(((i, a)) => ([Aim #(i + 1)],) + range(G.years * 2).map(_ => [■])).flatten())

  #if P.at("instrument", default: false) [
    = Potential utility and prospects for extension
    #todo[Who in the chemistry research community will use the instrument, and how the technique
    extends to other uses or fields.]
  ]

  #if "goali" in P [
    #let ind = G.investigators.filter(p => p.at("industry", default: false))
    = University–industry interaction (GOALI)
    *#P.goali.company* is the industrial partner#if ind.len() > 0 [; #ind.map(name).join(", ") is industrial co-PI].
    #todo[What each side does and why industry is critical to it; how the work leads to innovation;
    the long-term impact; the training trainees get in industry; how intellectual property and
    publication are handled (a signed agreement is due before award).]
  ]

  = Broader Impacts
  #todo[Benefit to society: training, broadening participation, infrastructure, public engagement,
  partnerships; how each is done and assessed.]

  #if "measures" in P [
    = Measures of success
    #table(columns: (auto, 1fr), stroke: 0.4pt, inset: 4pt, [*Measure*], [*This project*],
      ..P.measures.map(m => ([#m], todo[target, reported each year])).flatten())
  ]

  = Results from Prior NSF Support
  // Each PI and co-PI with an NSF award in the past five years: the most closely related one.
  #for p in G.investigators.filter(p => p.at("prior", default: none) != none) [
    *#name(p).* (a) #p.prior.award, #p.prior.amount, #p.prior.period. (b) #p.prior.title.
    (c) *Intellectual Merit:* #todo[results]. *Broader Impacts:* #todo[results].
    (d) *Publications:* #todo[complete citations, or "No publications were produced under this award."]
    (e) *Research products and their availability:* #todo[data, software, samples].
    (f) #p.prior.at("renewal", default: [Not a renewal.]) \
  ]
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: G.at("style", default: "american-chemical-society"))
]
