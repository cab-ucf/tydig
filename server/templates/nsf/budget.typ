// Budget Justification (5 pages), in Research.gov's budget lines. Numbers:
// budget.yaml, through lib/budget.typ (a cost's category: says its line);
// roles: grant.yaml.
#import "/lib/nsf.typ": *
#import "/lib/budget.typ": budget, warn, money, sum
#show: nsf
#let lines = (equipment: [D. Equipment], travel: [E. Travel], participant: [F. Participant Support Costs],
  materials: [G.1 Materials and Supplies], publication: [G.2 Publication Costs], consultant: [G.3 Consultant Services],
  computing: [G.4 Computer Services], subaward: [G.5 Subawards], other: [G.6 Other])

#section("budget", "Budget Justification", limit: 5)[
  #warn
  = A. Senior/Key Personnel and B. Other Personnel
  #for p in budget.personnel {
    let who = G.investigators.find(i => i.name == p.name)
    [*#if who != none { name(who) } else { p.name }#if who != none [, #who.role]* (#p.months.map(str).join(" / ")
      months in years #range(1, G.years + 1).map(str).join(" / ")). #todo[role and duties] \ ]
  }
  = C. Fringe Benefits
  #todo[The institution's rates, and what they cover.]
  #for (k, l) in lines {
    let os = budget.other.filter(o => o.at("category", default: "other") == k)
    if os.len() > 0 [
      = #l
      #for o in os [*#o.item* (#o.cost.map(money).join(" / ")). #todo[why it is needed] \ ]
    ]
  }
  = H. Indirect Costs
  #money(sum(budget.fa)) at #(G.at("fa_note", default: [the institution's negotiated rate])), on modified total direct costs.
  We request #money(sum(budget.total)) in all over #G.years years.
]
