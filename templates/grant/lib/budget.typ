// The budget, computed once from budget.yaml: budget-report.typ shows it,
// budget.typ justifies it, and `make budget` writes the same numbers into
// Excel (lib/budget_xlsx.py), so the three never disagree.
#let G = yaml("/grant.yaml")
#let B = (personnel: (), other: ()) + yaml("/budget.yaml")
#let yrs = range(G.years)
// a list of an entry a year, fit to grant.yaml's years: a year missing counts 0 (warn says so)
#let fit(xs) = yrs.map(y => xs.at(y, default: 0))
#let sum(xs) = xs.sum(default: 0)
#let money(x) = {
  let s = str(calc.round(x)).rev().clusters()
  let out = ""
  for (i, c) in s.enumerate() { if i > 0 and calc.rem(i, 3) == 0 { out = "," + out }; out = c + out }
  "$" + out
}
#let personnel = B.personnel.map(p => {
  let months = fit(p.months)
  let salary = yrs.map(y => p.salary * calc.pow(1 + B.rates.raise, y) * months.at(y) / 12)
  (name: p.name, months: months, salary: salary, fringe: salary.map(s => s * p.at("fringe", default: B.rates.fringe)))
})
#let other = B.other.map(o => (item: o.item, cost: fit(o.cost), base: o.at("fa", default: true), category: o.at("category", default: "other")))
#let direct = yrs.map(y => sum(personnel.map(p => p.salary.at(y) + p.fringe.at(y))) + sum(other.map(o => o.cost.at(y))))
// F&A (indirect) on modified total direct costs: what `fa: false` leaves out
#let fabase = yrs.map(y => direct.at(y) - sum(other.filter(o => not o.base).map(o => o.cost.at(y))))
#let fa = fabase.map(b => b * B.rates.fa)
// NIH modular budgets ask for direct costs in $25,000 modules; others
// (mechanism: modular: false) for the direct costs themselves
#let modular = G.mechanism.at("modular", default: true)
#let modules = direct.map(d => calc.ceil(d / 25000))
#let requested = if modular { modules.map(m => m * 25000) } else { direct }
#let cap = G.mechanism.at("cap", default: (:))
// effort a person on grant.yaml's investigators must give (min) or may be paid for (max), a year
#let months = G.mechanism.at("months", default: (:))
#let who = personnel.filter(p => G.investigators.any(i => i.name == p.name))
// whom those rules are about (not people paid elsewhere, through a subaward)
#let ruled = if "senior" in months {
  G.investigators.filter(i => i.at("organization", default: G.institution.name) == G.institution.name)
} else if "pi" in months { G.investigators.slice(0, 1) } else { () }
#let over = (
  ..(B.personnel.map(p => (p.name, p.months)) + B.other.map(o => (o.item, o.cost)))
    .filter(((n, xs)) => xs.len() != G.years)
    .map(((n, xs)) => [#n lists #xs.len() years; grant.yaml has #G.years]),
  ..ruled.filter(i => not personnel.any(p => p.name == i.name)).map(i =>
    [#i.name is not in budget.yaml's personnel by that name, so their months go unchecked]),
  ..yrs.filter(y => requested.at(y) > cap.at("year", default: calc.inf)).map(y => [year #(y + 1) asks #money(requested.at(y)) in direct costs, over the #G.mechanism.code limit of #money(cap.year) a year]),
  ..if sum(requested) > cap.at("total", default: calc.inf) { ([the #money(sum(requested)) total is over the #G.mechanism.code limit of #money(cap.total)],) } else { () },
  // NSF's limits are on the award: direct and indirect costs together
  ..if sum(direct) + sum(fa) > cap.at("award", default: calc.inf) { ([the award, #money(sum(direct) + sum(fa)) with indirect costs, is over the #G.mechanism.code limit of #money(cap.award)],) } else { () },
  ..if "pi" in months { who.filter(p => p.name == G.investigators.first().name).map(p => yrs.filter(y => p.months.at(y) < months.pi).map(y =>
    [#p.name gives #p.months.at(y) months in year #(y + 1); the #G.mechanism.code asks at least #months.pi])).flatten() },
  // GOALI: a small business's subaward at most this share of the whole budget
  ..if "subaward" in G.mechanism { let s = sum(other.filter(o => o.category == "subaward").map(o => sum(o.cost)))
    let t = sum(direct) + sum(fa)
    if s > G.mechanism.subaward * t { ([subawards are #calc.round(100 * s / t)% of the budget; the limit is #calc.round(100 * G.mechanism.subaward)%],) } else { () } },
  ..if "senior" in months { who.map(p => yrs.filter(y => p.months.at(y) > months.senior).map(y =>
    [#p.name is paid for #p.months.at(y) months in year #(y + 1); the limit is #months.senior])).flatten() },
)
#let budget = (years: G.years, personnel: personnel, other: other, direct: direct, fabase: fabase, fa: fa,
  total: yrs.map(y => direct.at(y) + fa.at(y)), modular: modular, modules: modules, requested: requested)
// over a cap, or not adding up: red, where it shows
#let warn = if over.len() > 0 { block(fill: red, inset: 6pt, width: 100%, text(white, weight: "bold")[Budget: #over.join("; ").]) }
