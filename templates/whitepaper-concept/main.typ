// A concept paper for a program officer: two pages (limits.body) that make
// the case and end with the questions to answer, before a full proposal.
#import "/lib/whitepaper.typ": *
#show: whitepaper

#section("body", none, limit: G.limits.body)[
  #titleblock()
  = The opportunity
  #todo[The problem, who has it, and why now, in a paragraph.]

  = The idea
  #todo[What is new, and why it should work.]

  = What we would do
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]
  #todo[Over #G.years years, at about #money(sum(budget.total)) in all.]

  = What it would change
  #todo[The outcomes, who benefits, and how we will know.]

  = Who we are
  #for p in G.investigators [*#name(p)*, #p.title: #todo[why this team can do it]. \ ]

  = Why #P.name
  #todo[How it serves the program's goals, in its own words.]

  = Our questions for you
  #for q in G.at("questions", default: ()) [- #q]
]

#section("references", "References")[
  #bibliography("/refs.bib", title: none, style: "american-psychological-association")
]
