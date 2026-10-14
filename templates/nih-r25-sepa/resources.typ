// Facilities & Other Resources: the educational environment (PAR-27-077).
#import "/lib/nih.typ": *
#show: nih

#section("resources", "Facilities & Other Resources", limit: none)[
  = #G.institution.name
  #todo[The educational environment: facilities, laboratories, departments, computing.]

  = Partners
  #for p in G.program.partners [*#p.name* (#p.role): #todo[what it brings]. \ ]

  = Related training and education support
  #todo[Every thematically related source of support for research training and education, in the
  Current and Pending (Other) Support format.]

  = Institutional commitment
  #todo[Staff, facilities and educational resources the institution commits.]
]
