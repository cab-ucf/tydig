// GOALI-Industrial PI Confirmation Letter (PAPPG II.F.5), uploaded under
// that name: from the company, on its letterhead, signed by an official.
// Not counted in the 15 pages. Its facts: program.goali in grant.yaml.
#import "/lib/nsf.typ": *
#show: nsf
#let g = G.program.goali
#let ind = G.investigators.filter(p => p.at("industry", default: false))

#todo[#g.company letterhead] #h(1fr) #todo[date]
#v(1em)
#name(pi) \ #pi.title \ #G.institution.department, #G.institution.name

Re: GOALI-Industrial PI Confirmation, "#G.title"

Dear Dr. #pi.name.split(" ").last(),

#g.company confirms that #ind.map(p => [#name(p), #p.title,]).join([ and ]) will serve as industrial co-Principal
Investigator on the above proposal to the National Science Foundation, devoting
#ind.map(p => str(p.at("months", default: todo[N]))).join(", ") month(s) a year to the project.

#g.company will contribute #g.contributes. #todo[Any further support the company gives the university.]
#if g.at("small_business", default: false) [#g.company will perform the subaward work described in the proposal
and certifies that it meets NSF's small-business eligibility for GOALI.]

#g.company and #G.institution.name will sign an agreement on intellectual property, including publication and
patent rights, before the award is made.

Sincerely,
#v(2em)
#todo[name, title of the authorized official] \
#g.company, #g.city
