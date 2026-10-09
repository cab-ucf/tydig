// Subaward Budget Justification: 5 pages for each subaward (PAPPG II.D.2.f).
// A for-profit subrecipient's costs follow FAR Part 31.
#import "/lib/nsf.typ": *
#import "/lib/budget.typ": budget, money, sum
#show: nsf
#let g = G.program.goali

#section("subaward", [Subaward Budget Justification: #g.company], limit: 5)[
  #let s = budget.other.filter(o => o.category == "subaward")
  We request #money(sum(s.map(o => sum(o.cost)))) for #g.company over #G.years years
  (#range(G.years).map(y => money(sum(s.map(o => o.cost.at(y))))).join(" / ")).
  = Personnel
  #todo[who at the company, months a year, and what they do]
  = Other direct costs
  #todo[materials, travel, instrument time]
  = Indirect costs
  #todo[the company's federally negotiated rate, or the basis for its rate]
]
