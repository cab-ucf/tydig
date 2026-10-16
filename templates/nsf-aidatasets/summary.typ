// Project Summary: one page, in three parts NSF names (PAPPG II.D.2.b), its
// last line NSF 26-512's keywords (keywords: in grant.yaml). It goes into
// Research.gov's three boxes; upload the PDF only for special characters.
#import "/lib/nsf.typ": *
#show: nsf
#let k = G.at("keywords", default: ())

#section("summary", "Project Summary", limit: 1)[
  == Overview
  #todo[The datasets, what enhancing them makes possible with AI, and for whom, in plain terms.]
  This project pursues #G.aims.len() aims:
  #G.aims.enumerate().map(((i, a)) => [(#(i + 1)) #lower(a.title.first())#a.title.slice(a.title.first().len())]).join("; ", last: "; and ").

  == Intellectual Merit
  #todo[The new discoveries the enhanced datasets enable, and why they matter.]

  == Broader Impacts
  #todo[The communities that benefit, the people trained, and the infrastructure left behind.]

  #if k.len() < 2 or k.len() > 5 { box(fill: red, inset: 2pt, text(white)[keywords: 2 to 5, not #k.len()]) }
  Keywords: #k.join("; ")
]
