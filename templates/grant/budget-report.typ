// The detailed budget, for your grants office: every number comes from
// budget.yaml through lib/budget.typ; `make budget` gives the same as Excel.
#import "/lib/format.typ": *
#import "/lib/budget.typ": *
#show: format

#section("budget-report", [Detailed budget (internal)], limit: none)[
  #warn
  #set text(9pt)
  #let row(label, xs) = (label, ..xs.map(money), money(sum(xs)))
  #table(columns: (1fr,) + (auto,) * (G.years + 1), align: (left,) + (right,) * (G.years + 1), stroke: 0.4pt, inset: 4pt,
    [], ..yrs.map(y => [*Year #(y + 1)*]), [*Total*],
    ..budget.personnel.map(p => (..row([#p.name (#p.months.map(str).join(", ") months)], p.salary), ..row([#h(1em) fringe], p.fringe))).flatten(),
    ..budget.other.map(o => row([#o.item#if not o.base [ (no F&A)]], o.cost)).flatten(),
    ..row([*Direct costs*], direct), ..row([F&A at #(B.rates.fa * 100)%], fa), ..row([*Total*], budget.total),
    ..row(if modular [*Requested (#modules.map(str).join(", ") modules)*] else [*Requested direct costs*], requested))
]
