// NIH format (SF424 R&R guide): US letter, margins of at least half an inch,
// 11 pt or larger in Arial, Helvetica, Palatino Linotype or Georgia (Liberation
// Sans is Arial's metric twin), no more than six lines per inch, and no headers,
// footers or page numbers: NIH stamps its own.
//
// Paths here start with "/": a relative path resolves from the file that
// names it (this one, in lib/), not from the document being compiled.
#let G = yaml("/grant.yaml")
#let pi = G.investigators.first()
#let name(p) = p.name + if p.at("degrees", default: none) != none [, #p.degrees]

#let nih(body) = {
  set page("us-letter", margin: 0.5in)
  set text(font: "Liberation Sans", size: 11pt)
  set par(justify: true, leading: 0.5em)
  set block(spacing: 0.9em)
  show heading: set text(11pt)
  show heading.where(level: 1): set block(above: 1em, below: 0.6em)
  body
}

// One NIH attachment: starts a page, marks its first page for the Makefile
// (which cuts main.typ into separate PDFs) and, over its page limit, prints
// a red warning on its first page, so the preview says so before NIH does.
#let section(key, title, limit: none, body) = {
  pagebreak(weak: true)
  context [#metadata(here().page())#label(key)]
  if limit != none {
    context {
      let n = query(label(key + "-end")).first().location().page() - here().page() + 1
      if n > limit { place(top + right, dy: -0.4in, box(fill: red, inset: 4pt,
        text(white, 9pt, weight: "bold")[#title: #n pages, limit #limit])) }
    }
  }
  if title != none { align(center, text(12pt, weight: "bold", title)) }
  body
  [#metadata(none)#label(key + "-end")]
}

// A letter of support, from an entry under letters: in grant.yaml.
#let letter(l) = {
  pagebreak(weak: true)
  set par(justify: false)
  align(right)[#l.date]
  v(1em)
  [#name(pi) \ #pi.title \ #G.institution.name]
  v(1em)
  [Dear Dr. #pi.name.split(" ").last(),]
  parbreak()
  eval(l.body, mode: "markup", scope: (G: G, pi: pi))
  v(1em)
  [Sincerely,]
  if l.at("signature", default: none) != none { image("/" + l.signature, height: 0.5in) } else { v(0.5in) }
  [#l.name \ #l.title \ #l.institution]
}
