// Project Summary/Abstract: 30 lines of text at most. Written for a broad
// scientific audience: the problem, the aims, and the expected impact.
#import "/lib/nih.typ": *
#show: nih

#section("summary", "Project Summary", limit: 1)[
  #lorem(90)

  This #G.mechanism.code will pursue #G.aims.len() aims:
  #G.aims.enumerate().map(((i, a)) => [(#(i + 1)) #lower(a.title)]).join("; ", last: "; and ").
  #lorem(40)
]
