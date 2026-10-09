// The budget, computed once from budget.yaml: budget-report.typ shows it,
// budget.typ justifies it, and `make budget` writes the same numbers into
// Excel (lib/budget_xlsx.py), so the three never disagree.
#let G = yaml("/grant.yaml")
#let B = yaml("/budget.yaml")
#let yrs = range(G.years)
#let sum(xs) = xs.sum(default: 0)
#let money(x) = {
  let s = str(calc.round(x)).rev().clusters()
  let out = ""
  for (i, c) in s.enumerate() { if i > 0 and calc.rem(i, 3) == 0 { out = "," + out }; out = c + out }
  "$" + out
}
#let personnel = B.personnel.map(p => {
  let salary = yrs.map(y => p.salary * calc.pow(1 + B.rates.raise, y) * p.months.at(y) / 12)
  (name: p.name, months: p.months, salary: salary, fringe: salary.map(s => s * p.at("fringe", default: B.rates.fringe)))
})
#let other = B.at("other", default: ()).map(o => (item: o.item, cost: o.cost, base: o.at("fa", default: true)))
#let direct = yrs.map(y => sum(personnel.map(p => p.salary.at(y) + p.fringe.at(y))) + sum(other.map(o => o.cost.at(y))))
// F&A (indirect) on modified total direct costs: what `fa: false` leaves out
#let fabase = yrs.map(y => direct.at(y) - sum(other.filter(o => not o.base).map(o => o.cost.at(y))))
#let fa = fabase.map(b => b * B.rates.fa)
// NIH modular budgets ask for direct costs in $25,000 modules
#let modules = direct.map(d => calc.ceil(d / 25000))
#let requested = modules.map(m => m * 25000)
#let cap = G.mechanism.at("cap", default: (:))
#let over = (
  ..yrs.filter(y => requested.at(y) > cap.at("year", default: calc.inf)).map(y => [year #(y + 1) asks #money(requested.at(y)) in direct costs, over the #G.mechanism.code limit of #money(cap.year) a year]),
  ..if sum(requested) > cap.at("total", default: calc.inf) { ([the #money(sum(requested)) total is over the #G.mechanism.code limit of #money(cap.total)],) } else { () },
)
#let budget = (years: G.years, personnel: personnel, other: other, direct: direct, fabase: fabase, fa: fa,
  total: yrs.map(y => direct.at(y) + fa.at(y)), modules: modules, requested: requested, excel: B.at("excel", default: none))
// over a cap: red, where it shows
#let warn = if over.len() > 0 { block(fill: red, inset: 6pt, width: 100%, text(white, weight: "bold")[Budget: #over.join("; ").]) }
