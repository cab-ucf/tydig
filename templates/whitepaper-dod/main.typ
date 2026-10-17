// A white paper to a DoD service's BAA: a cover page, then the body under
// the call's page limit (limits.body), then references, outside it. The
// headings are the ones such calls ask for; the call decides over them.
#import "/lib/whitepaper.typ": *
#show: whitepaper

#section("cover", none)[
  #set page(numbering: none)
  #align(center, text(1.35em, weight: "bold", G.title))
  #v(1em)
  #table(columns: (auto, 1fr), stroke: 0.4pt, inset: 6pt,
    [*Announcement*], [#P.call#if "topic" in P [; topic: #P.topic]],
    [*Submitted to*], [#P.manager, #P.name, #P.agency (#P.email)],
    [*Type of effort*], [#P.at("research", default: todo[basic or applied research])],
    [*Technical point of contact*], [#name(pi), #pi.title \ #G.institution.department, #G.institution.name \
      #G.institution.address \ #pi.email#if "phone" in pi [, #pi.phone]],
    [*Administrative point of contact*], if "admin" in G.institution [#G.institution.admin.name \
      #G.institution.admin.email, #G.institution.admin.phone] else { todo[the grants or contracts office] },
    [*Other investigators*], [#G.investigators.slice(1).map(p => [#name(p), #p.title]).join("; ")],
    [*Period of performance*], [#G.years years],
    [*Cost (ROM)*], [#money(sum(budget.total)) in all: #budget.total.map(money).join(", ") a year],
    [*Date*], G.at("date", default: todo[date]))
]

#section("body", none, limit: G.limits.body)[
  #counter(page).update(1)
  = Technical concept
  #todo[The scientific or technical problem, and the idea that solves it, in a paragraph a non-specialist follows.]
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]

  = Background and the state of the art
  #todo[What is done today, its limits, and what is new here.]

  = Technical approach
  #for (i, a) in G.aims.enumerate() [
    == #(i + 1). #a.title
    #todo[How; what could go wrong, and the alternative; who does it.]
  ]

  = #P.at("relevance", default: "Relevance to the mission")
  #todo[What #P.agency gets: the capability, who in the fleet or force uses it, and how it moves toward them.]

  = Milestones and deliverables
  #milestones()
  #for d in G.at("deliverables", default: ()) [- #d]

  = Key personnel
  #for p in G.investigators [- *#name(p)*, #p.title, #p.at("organization", default: G.institution.name):
    #todo[role, and the expertise behind it].
  ]

  = Rough order of magnitude cost
  #rom()
]

#references("ieee")
