// The email that carries the Concept Outline (concept.typ, attached), to
// paste: it asks the program officers for concurrence (PAPPG II.F.1).
#import "/lib/nsf.typ": *
#show: nsf
#let P = G.program

#section("note", none, limit: 1)[
  #set par(justify: false)
  To: #P.contact \
  Subject: Concept Outline for a planning proposal (#G.nofo): #G.title

  Dear #P.name Program Officers,

  I plan to submit a planning proposal to #G.nofo by the #P.due deadline and request
  concurrence, as PAPPG II.F.1 requires. My two-page Concept Outline is attached.

  #todo[In brief: the datasets, what enhancing them makes possible, and what planning funds would do.]

  Could you confirm whether this fits the Planning track and, if so, provide concurrence for upload as
  "Planning – Program Officer Concurrence Email"?

  Thank you, \
  #name(pi) \ #pi.title, #G.institution.department, #G.institution.name \ #pi.email
]
