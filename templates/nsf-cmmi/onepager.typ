// The one-page project summary NSF 26-515 strongly encourages emailing to the
// cognizant program director(s) before submitting: guidance on fit, not
// review. Not uploaded.
#import "/lib/nsf.typ": *
#show: nsf

#section("onepager", "Project summary for the program director", limit: 1)[
  *#G.title* \
  #name(pi), #pi.title, #G.institution.department, #G.institution.name \
  For #G.program.director, #G.program.name (#G.program.contact)

  = The problem
  #todo[What is not known or cannot be done, and why it matters to engineering.]

  = What we will do
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]

  = Why this program
  #todo[Why it fits #G.program.name, and the questions for the program director.]
]
