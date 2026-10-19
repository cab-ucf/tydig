// ARPA-H's format (letter, 1 in margins, Arial 11 pt or larger, page numbers
// at the foot, the call, proposer and short title in each header), and what
// the volumes share, each from grant.yaml and budget.yaml: the cover page,
// the Basis of Estimate by phase, the metrics, milestones, tasks, schedule,
// target product profiles and key personnel.
#import "/lib/grant.typ": *
#import "/lib/brand.typ": accent
#import "/lib/budget.typ": B, budget, money, sum, warn, yrs
#let P = G.program
#let I = G.institution

#let arpah(vol: none, size: 11, margin: 1in, body) = {
  set page("us-letter", margin: margin, numbering: "1", header: text(8pt,
    fill: luma(40%))[#P.call · #if vol != none [#vol\_]#I.name #h(1fr) #G.short])
  set text(font: ("Arial", "Liberation Sans"), size: size * 1pt)
  set par(justify: true, leading: 0.55em, spacing: 0.8em)
  show heading: set text(size * 1pt + 1pt)
  show heading: set block(above: 1em, below: 0.5em)
  show table: set text(0.85em)
  show table: set par(justify: false)
  body
}

// months from the start at which each phase ends
#let edges = G.phases.fold((0,), (a, p) => a + (a.last() + p.months,))
// a list a year into a list a phase, by the months each shares
#let phased(xs) = range(G.phases.len()).map(p => sum(yrs.map(y => xs.at(y) *
  calc.max(0, calc.min(12 * y + 12, edges.at(p + 1)) - calc.max(12 * y, edges.at(p))) / 12)))
#let cat(c) = yrs.map(y => sum(budget.other.filter(o => o.category == c).map(o => o.cost.at(y))))
#let fee = budget.total.map(t => t * B.rates.at("fee", default: 0))
#let total = yrs.map(y => budget.total.at(y) + fee.at(y))

#let pocs = (p, ..a) => [#p.name \ #a.pos().join(" \\ ")]
#let team = G.investigators.filter(p => "organization" in p)

// The cover page, as the ISO lays it out (kind: what this volume is)
#let cover(kind) = section("cover", none)[
  #set page(numbering: none)
  #align(center, text(1.3em, weight: "bold")[#P.name: #kind])
  #v(0.5em)
  #table(columns: (auto, 1fr), stroke: 0.4pt, inset: 5pt,
    [*Innovative Solutions Opening*], P.call,
    [*Title*], G.title,
    [*Technical areas*], P.areas,
    [*Prime proposer*], [#I.name, #I.department],
    [*Unique Entity Identifier (UEI)*], I.uei,
    [*Type of organization*], [#I.type (#I.url)],
    [*Date of submission*], G.date,
    [*Technical POC*], [#name(pi), #pi.title \ #I.address \ #pi.phone · #pi.email],
    [*Administrative POC* (authorized to negotiate)],
      [#I.admin.name \ #I.address \ #I.admin.phone · #I.admin.email],
    [*Other team members*], team.map(p => [#name(p), #p.organization
      (#p.orgtype)]).join[ \ ],
    [*Total funds requested (BOE)*], [#money(sum(total))#if sum(B.share) > 0 [;
      cost share #money(sum(B.share))]],
    [*Place(s) of performance*], G.places.join[; ])
  #counter(page).update(0)
]

// The Basis of Estimate: each category a phase, as the ISO's table asks
#let boe() = {
  warn
  if edges.last() != G.years * 12 { text(red)[*The phases are #edges.last()
    months; budget.yaml has #G.years years.*] }
  let row(l, xs) = (l, ..phased(xs).map(money), money(sum(xs)))
  let hours = yrs.map(y => sum(budget.personnel.map(p => p.months.at(y))) * 2080 / 12)
  table(columns: (1fr,) + (auto,) * (G.phases.len() + 1), stroke: 0.4pt,
    inset: 4pt, align: (left,) + (right,) * (G.phases.len() + 1),
    [*Category*], ..G.phases.map(p => [*#p.name*]), [*Total*],
    ..row([Direct labor (fully burdened, with fringe)], yrs.map(y =>
      sum(budget.personnel.map(p => p.salary.at(y) + p.fringe.at(y))))),
    [Labor hours], ..phased(hours).map(h => str(calc.round(h))),
      str(calc.round(sum(hours))),
    ..row([Subawards (vendors, consultants)], cat("subaward")),
    ..row([Materials], cat("materials")), ..row([Equipment], cat("equipment")),
    ..row([Travel], cat("travel")), ..row([Other direct costs], cat("other")),
    ..row([Indirect costs], budget.fa), ..row([Profit/fee], fee),
    ..row([*Total*], total), ..row([Cost share], B.share))
}

// Today's best against each phase's goal
#let metrics() = table(columns: (1fr, auto) + (auto,) * G.phases.len(),
  stroke: 0.4pt, inset: 4pt,
  [*Metric*], [*Today*], ..G.phases.map(p => [*#p.name*]),
  ..G.metrics.map(m => (m.metric, m.today, ..m.goals)).flatten())

#let milestones() = table(columns: (auto, auto, 1fr, 1fr), stroke: 0.4pt, inset: 4pt,
  [*Month*], [*Task*], [*Milestone*], [*Deliverable*],
  ..G.tasks.sorted(key: t => t.end).map(t =>
    ([#t.end], [#t.id (#t.ta)], t.milestone, t.deliverable)).flatten())

// The Task Description Document: each phase, each task, who and what
#let tdd() = for (i, p) in G.phases.enumerate() [
  == #p.name (months #(edges.at(i) + 1)–#edges.at(i + 1)): #p.aim
  #for t in G.tasks.filter(t => t.phase == i + 1) [
    *Task #t.id (#t.ta): #t.title.* Months #t.start–#t.end; #t.org. \
    #todo[the approach, step by step] \
    _Milestone:_ #t.milestone (month #t.end). _Deliverable:_ #t.deliverable.
    #parbreak()
  ]
]

// The schedule: a column a quarter, a bar a task, ◆ its milestone
#let schedule() = {
  let q = calc.ceil(edges.last() / 3)
  set text(7pt)
  table(columns: (auto, auto) + (1fr,) * q, stroke: 0.3pt, inset: 2pt, align: center,
    [*Task*], [*Org*], ..range(q).map(i => [Q#(i + 1)]),
    ..G.tasks.map(t => (align(left)[#t.id #t.title], t.org, ..range(q).map(i =>
      if calc.ceil(t.end / 3) == i + 1 { table.cell(fill: accent)[◆] }
      else if 3 * i + 3 >= t.start and 3 * i < t.end { table.cell(fill: accent.lighten(60%))[] }
      else []))).flatten())
}

// A target product profile, a page; a blank row is a prompt
#let tpp(t) = table(columns: (auto, 1fr), stroke: 0.4pt, inset: 5pt,
  ..t.pairs().map(((k, v)) => ([*#k*], if v == none { todo(k) } else [#v])).flatten())

#let personnel() = table(columns: 6, stroke: 0.4pt, inset: 4pt,
  [*Organization*], [*Last name*], [*First name*], [*City*], [*State*], [*Country*],
  ..G.investigators.map(p => (p.at("organization", default: I.name),
    p.name.split(" ").last(), p.name.split(" ").slice(0, -1).join(" "),
    p.city, p.state, p.country)).flatten())

// effort, calendar months a year, from budget.yaml
#let effort() = table(columns: (1fr,) + (auto,) * G.years, stroke: 0.4pt, inset: 4pt,
  [*Person*], ..yrs.map(y => [*Year #(y + 1)*]),
  ..budget.personnel.map(p => (p.name, ..p.months.map(str))).flatten())

#let iptable() = table(columns: 7, stroke: 0.4pt, inset: 3pt,
  ..([Category], [USPTO / docket / application no.], [Title], [Intended use],
    [Government rights], [Owner], [Funding]).map(strong),
  ..G.ip.map(x => (x.category, x.number, x.title, x.use, x.rights, x.owner,
    x.funding)).flatten())
