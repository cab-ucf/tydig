// Project Summary/Abstract (30 lines): the laboratory's research, its goals
// for the next five years and the program's overall vision. Never "aims".
#import "/lib/nih.typ": *
#show: nih

#section("summary", "Project Summary", limit: 1)[
  #todo[An overview of the laboratory's research relevant to NIGMS.]

  Over the next five years the program pursues #G.directions.len() directions:
  #G.directions.map(d => lower(d.title)).join("; ", last: "; and ").
  #todo[The overall vision of the research program, and its expected impact.]
]
