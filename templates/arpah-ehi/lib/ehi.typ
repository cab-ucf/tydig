// ARPA-H EHI's format (letter, 1 in margins, 12 pt sans serif, tables at
// 10 pt), and what the documents share, from grant.yaml and budget.yaml: the
// topic, the cover rows, the blind-review check, the milestones and their
// payments a quarter.
#import "/lib/grant.typ": *
#import "/lib/budget.typ": B, budget, money, sum, warn, yrs
#let P = G.program
#let I = G.institution

#let topics = ("Precision Control of Skin Inflammation without Systemic Exposure",
  "Internal Sensing and Targeted Control of Inflammation",
  "Deep Brain Stimulation for Mechanistic Sleep Exploration (Deep Sleep)",
  "CLEAR-MIND: Restoring the Brain's Drainage and Immune Balance to Enable Healing After Injury",
  "Host-Pathway Interventions for Neurotropic Disease (HIND)",
  "Protecting Patient Data in Life Science AI",
  "Engineering DRT for Programmable DNA Synthesis as Emerging New Medical Countermeasures (MCM) Strategy",
  "Prevention of Lethal Alpha-gal Allergic Responses Caused by Tick Bites",
  "SMILE (Smart Microbiome-Informed Lesion & Enamel Restoration)",
  "Ending Preventable Deaths from Ectopic Pregnancy Through First-Visit Diagnosis",
  "Transforming the Well-Woman Exam through Objective Data",
  "Innovations in Biotransport to Support Long-Term Preservation of Tissues and Organs",
  "Organs-in-Action: Next-Generation Human Tissue Platforms for Longevity, Disease, and Therapy Discovery",
  "Near Real-time, Non-contact Determination of Sterility in Distributed Manufacturing Systems",
  "ICAT (In-Cavity Adjuvant Therapy): Implantable Systems for Local Cancer Control at the Resection Margin",
  "Causally-Grounded Alignment for Clinical Generative Artificial Intelligence Tools")
#let topic = [Topic #G.topic: #topics.at(G.topic - 1)]

// No name in the header: the summary is reviewed blind
#let ehi(body) = {
  set document(title: G.title, author: ())
  set page("us-letter", margin: 1in, numbering: "1", header: text(9pt,
    fill: luma(40%))[#P.call · Topic #G.topic · #G.short #h(1fr)
    #if G.proprietary { text(black, weight: "bold")[Proprietary] }])
  set text(font: ("Arial", "Liberation Sans"), size: 12pt)
  set par(justify: true, leading: 0.55em, spacing: 0.8em)
  show heading: set text(12pt)
  show heading: set block(above: 1em, below: 0.5em)
  show table: set text(10pt)
  show table: set par(justify: false)
  body
}

#let check(on) = box(stroke: 0.5pt, width: 0.8em, height: 0.8em, baseline: 0.1em,
  align(center + horizon, if on { text(0.8em, weight: "bold")[X] }))
#let types(have) = ("For-Profit", "Non-profit", "Academia").map(t =>
  [#check(t in have) #t]).join(h(1em))
#let poc(p, address: "Address") = [Name: #p.name \ #address: #I.address \
  Telephone: #p.phone \ Email: #p.email]
#let team = G.investigators.filter(p => "organization" in p)
#let rows(..r) = table(columns: (2fr, 3fr), stroke: 0.5pt, inset: 5pt,
  ..r.pos().map(((k, v)) => ([*#k*], [#v])).flatten())

// What would name the team, red where review is blind
#let blind(body) = {
  let esc(s) = "\\^$.|?*+()[]{}".clusters().fold(s, (s, c) => s.replace(c, "\\" + c))
  let words = (G.investigators.map(p => (p.name, p.name.split(" ").last())).flatten()
    + team.map(p => p.organization) + (I.name, I.department) + G.at("anonymize", default: ()))
  let names = regex("(?i)\\b(" + words.map(w => esc(w.trim("."))).join("|") + ")\\b")
  show names: it => highlight(fill: red, text(white)[#it (names the team)])
  body
}

// Milestones in the order written, each with its task's number
#let ms = G.tasks.enumerate().map(((i, t)) => t.milestones.map(m => m + (task: i + 1))).flatten()
#let qs(m) = if m.q.first() == m.q.last() [Q#m.q.last()] else [Q#m.q.first()–Q#m.q.last()]
#let year(m) = calc.quo(m.q.last() - 1, 4)
// Each year's cost split evenly over the milestones it pays, unless set
#let pay(m) = m.at("amount", default: budget.total.at(year(m), default: 0) /
  ms.filter(n => year(n) == year(m)).len())
#let paid = ms.sorted(key: m => m.q.last())
#let ends(q) = {
  let (y, mo, d) = str(G.start).split("-").map(int)
  let m = mo - 1 + 3 * q
  datetime(year: y + calc.quo(m, 12), month: calc.rem(m, 12) + 1, day: d) - duration(days: 1)
}
#let date(d) = d.display("[month]/[day]/[year]")
#let base = sum(paid.filter(m => m.q.last() <= 8).map(pay))
#let option = sum(paid.filter(m => m.q.last() > 8).map(pay))
#let off = (
  ..range(1, 13).filter(q => paid.filter(m => m.q.last() == q).len() != 1).map(q =>
    [Q#q has #paid.filter(m => m.q.last() == q).len() milestones; ARPA-H asks one]),
  ..if base > 700000 { ([the base period is #money(base), over $700,000],) },
  ..if option > 350000 { ([the option is #money(option), over $350,000],) },
)
#let plan-warn = if off.len() > 0 { block(fill: red, inset: 6pt, width: 100%,
  text(white, weight: "bold")[Milestones: #off.join("; ").]) }

// The steps, each with its quarters, milestones and go/no-go
#let plan() = {
  plan-warn
  table(columns: (1.1fr, auto, 2fr, 1fr), stroke: 0.5pt, inset: 4pt,
    [*Step*], [*Quarters*], [*Milestones (quantitative metric)*], [*Go/no-go*],
    ..G.tasks.enumerate().map(((i, t)) => ([#(i + 1). #t.title],
      [Q#t.milestones.first().q.first()–Q#t.milestones.last().q.last()],
      t.milestones.map(m => [#m.name: #m.metric]).join[ \ ], t.gonogo)).flatten())
}
