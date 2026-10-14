// Budget justification: each person's role and effort, the modules asked for
// (or, without modules, each cost), then what needs explaining. Numbers: budget.yaml, through
// lib/budget.typ; roles and degrees: grant.yaml.
#import "/lib/nih.typ": *
#import "/lib/budget.typ": budget, warn, money, sum
#show: nih

#section("budget", "Budget Justification", limit: none)[
  #warn
  = Personnel
  #for p in budget.personnel {
    let who = G.investigators.find(i => i.name == p.name)
    [*#if who != none { name(who) } else { p.name }#if who != none [, #who.role]* (#p.months.map(str).join(" / ") calendar
      months in years #range(1, G.years + 1).map(str).join(" / ")). #if who != none { who.at("duties", default: lorem(20)) } \ ]
  }

  #if budget.modular [
    = Modules
    We request #budget.modules.enumerate().map(((y, m)) => [#m modules (#money(m * 25000)) in year #(y + 1)]).join(", ", last: " and "):
    #money(sum(budget.requested)) in direct costs. #G.mechanism.budget_rule
  ] else [
    = Other direct costs
    #for o in budget.other [*#o.item* (#o.cost.map(money).join(" / ")). #todo[why the program needs it] \ ]
    = Total
    We request #money(sum(budget.requested)) in direct costs over #G.years years. #G.mechanism.budget_rule
  ]

  = Additional narrative
  #lorem(40)
]
