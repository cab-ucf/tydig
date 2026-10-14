// Project Summary: one page, in three parts NSF names (PAPPG II.D.2.b). It
// goes into Research.gov's three boxes; upload the PDF only for special characters.
#import "/lib/nsf.typ": *
#show: nsf

#section("summary", "Project Summary", limit: 1)[
  == Overview
  #todo[What the project does and for whom, in plain terms.]
  This project pursues #G.aims.len() aims:
  #G.aims.enumerate().map(((i, a)) => [(#(i + 1)) #lower(a.title)]).join("; ", last: "; and ").

  == Intellectual Merit
  #todo[The new knowledge, and why it matters to the field.]

  == Broader Impacts
  #todo[The benefit to society and to the people trained.]
]
