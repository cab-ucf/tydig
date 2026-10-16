// The Project Description (limits: description pages, Results from Prior NSF
// Support within them) and References Cited: one document, so @citations
// resolve, cut where References Cited starts by `make`. Facts come from
// grant.yaml; program: there adds the sections a program asks for (EAGER,
// GOALI, instrument development, rigor, measures of success). A grey
// [prompt] is what reviewers look for there.
#import "/lib/nsf.typ": *
#show: nsf
#let P = G.program

#section("description", none, limit: G.limits.description)[
  = Overview and objectives
  #todo[The problem, why it matters to the field, and what this project will establish @pappg.]
  #for (i, a) in G.aims.enumerate() [*Aim #(i + 1). #a.title.* #a.summary \ ]

  #if "eager" in P [
    = Why EAGER
    #todo[Why the idea is untested and potentially transformative, and the risk worth taking; why it
    fits no existing program or regular proposal, and is neither a planning grant nor preliminary data
    for one; what #G.years years will show, either way. Concurred by #P.eager.officer
    (#P.eager.date).]
  ]

  = Background and relation to prior work
  #todo[The state of the art, and the gap this work fills.]

  = Preliminary results
  #todo[What shows this can work. Label simulated figures as simulations.]

  = Research plan
  #for (i, a) in G.aims.enumerate() [
    == Aim #(i + 1): #a.title
    #todo[Approach, expected results, risks and alternatives; who does it.]
  ]

  #if P.at("rigor", default: false) [
    == Rigor, transparency and reproducibility
    #todo[How the results will be checked and repeated: controls, uncertainty, the data and code
    released with them, and how others can reproduce them.]
  ]

  #if P.at("instrument", default: false) [
    = Development timeline
  ] else [
    == Timeline
  ]
  #timeline()

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

  #if "measures" in P { measures(P.measures) }

  #prior()
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: G.at("style", default: "american-chemical-society"))
]
