// A white paper's format, as the program manager's call sets it (format: in
// grant.yaml: font, size, page numbers), letter paper with 1 in margins; and
// what every style shares: the title block, the cost (ROM), the milestones
// and the references, each from grant.yaml, budget.yaml and refs.bib.
#import "/lib/grant.typ": *
#import "/lib/brand.typ": accent
#import "/lib/budget.typ": budget, money, sum
#let F = G.at("format", default: (:))
#let P = G.program

#let whitepaper(body) = {
  set page("us-letter", margin: 1in, numbering: if F.at("numbers", default: true) { "1" })
  set text(font: F.at("font", default: ("Arial", "Liberation Sans")), size: F.at("size", default: 11) * 1pt)
  set par(justify: true, leading: 0.6em, spacing: 0.9em)
  show heading: set text(size: F.at("size", default: 11) * 1pt + 1pt)
  show heading: set block(above: 1.1em, below: 0.55em)
  show table: set text(0.9em)
  show table: set par(justify: false)
  body
}

// The title, who, and for whom: the top of the first page
#let titleblock() = {
  align(center, text(1.35em, weight: "bold", G.title))
  v(0.2em)
  align(center, G.investigators.map(p => [#name(p) (#p.at("organization", default: G.institution.name))]).join(", "))
  align(center, text(0.9em)[#pi.email · #G.mechanism.code to #P.manager, #P.name, #P.agency#if "call" in P [ · #P.call]
    · #G.at("date", default: todo[date])])
  line(length: 100%, stroke: 1pt + accent)
}

// The cost, a rough order of magnitude: each year, and in all, indirect costs included
#let rom() = table(columns: (1fr,) + (auto,) * (G.years + 1), align: (left,) + (right,) * (G.years + 1),
  stroke: 0.4pt, inset: 4pt,
  [], ..range(G.years).map(y => [*Year #(y + 1)*]), [*Total*],
  [Direct costs], ..budget.direct.map(money), money(sum(budget.direct)),
  [Indirect costs], ..budget.fa.map(money), money(sum(budget.fa)),
  [*Total*], ..budget.total.map(x => [*#money(x)*]), [*#money(sum(budget.total))*])

// When, what, and the test that says it worked (milestones: in grant.yaml)
#let milestones() = table(columns: (auto, 1fr, 1fr), stroke: 0.4pt, inset: 4pt,
  [*Month*], [*Milestone*], [*How we will know*],
  ..G.milestones.map(m => ([#m.month], [#m.what], [#m.exam])).flatten())

// References, outside the page limit: a page of them once anything is cited
// (@key to no label in the document is a citation)
#let references(style) = context if query(cite) != () or query(ref).any(r => query(r.target) == ()) {
  section("references", "References", bibliography("/refs.bib", title: none, style: style))
}
