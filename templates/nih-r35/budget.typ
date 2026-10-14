// Budget Justification, MIRA style: the R&R budget is not itemised (the
// PD/PI at $0 in Section A, the request in Section F), so this explains only
// equipment, data management and sharing costs, and what F&A excludes.
// Numbers: budget.yaml, through lib/budget.typ.
#import "/lib/nih.typ": *
#import "/lib/budget.typ": budget, warn, money, sum
#show: nih
#let e = G.effort

#section("budget", "Budget Justification", limit: none)[
  #warn
  #if e.mira / e.research < G.mechanism.effort / 100 {
    box(fill: red, inset: 4pt, text(white)[#e.mira of #e.research research months is
      #calc.round(100 * e.mira / e.research)% on the MIRA; the NOFO asks at least #G.mechanism.effort%.])
  }
  We request #budget.requested.map(money).join(" / ") in direct costs in years 1 to #G.years
  (#money(sum(budget.requested)) in all). #G.mechanism.budget_rule
  #for o in budget.other.filter(o => o.category in ("equipment", "dms")) [
    = #if o.category == "dms" [Data Management and Sharing Justification] else [Equipment]
    *#o.item* (#o.cost.map(money).join(" / ")). #todo[what it is, and why the program needs it] \
  ]
  = F&A
  #todo[What the institution's rate excludes from the base (equipment, tuition).]
]
