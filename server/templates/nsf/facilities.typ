// Facilities, Equipment and Other Resources: a narrative, with no dollar
// figures (PAPPG II.D.2.g). Partners' and unfunded collaborators' resources too.
#import "/lib/nsf.typ": *
#show: nsf

#section("facilities", "Facilities, Equipment and Other Resources", limit: none)[
  #for p in G.investigators [*#name(p), #p.at("organization", default: G.institution.name).* #todo[laboratory, instruments, computing]. \ ]
  #for c in G.at("collaborators", default: ()) [*#c.name, #c.organization (unfunded collaborator).* #todo[what they bring]. \ ]
  *#G.institution.name shared facilities.* #todo[core facilities, cleanroom, computing].
]
