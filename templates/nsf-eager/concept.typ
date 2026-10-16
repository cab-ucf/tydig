// The Concept Outline (PAPPG II.F.3): emailed to the program officer before
// anything else, and not uploaded. Their approving email is what lets the
// EAGER be submitted: upload it as the Program Officer Concurrence Email.
#import "/lib/nsf.typ": *
#import "/lib/budget.typ": budget, money, sum
#show: nsf

#section("concept", "Concept Outline", limit: 2)[
  *#G.title* \
  #name(pi), #pi.title, #G.institution.department, #G.institution.name \
  For #G.program.name (#G.program.contact)

  = The idea
  #todo[In a paragraph: what is untested, and what it would change if it works.]

  = Why it is exploratory, and why EAGER
  #todo[The risk, and why it is worth taking; why no regular proposal or existing program fits it.]

  = What we will do in #G.years years
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]

  = Request
  About #money(sum(budget.total)) over #G.years years, indirect costs included.
]
