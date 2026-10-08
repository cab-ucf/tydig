// Modular budget justification: personnel by name, role and effort (from
// grant.yaml), then anything that needs explaining, such as consortium costs.
#import "/lib/nih.typ": *
#show: nih

#section("budget", "Budget Justification", limit: none)[
  = Personnel
  #for p in G.investigators [
    *#name(p), #p.role* (#p.months calendar months per year). #p.at("duties", default: lorem(25)) \
  ]

  = Modules
  We request #G.budget.modules modules (#G.budget.modules × \$25,000 =
  \$#(G.budget.modules * 25)K) in direct costs per year for #G.years years.
  #G.mechanism.budget_rule

  = Additional narrative
  #lorem(40)
]
