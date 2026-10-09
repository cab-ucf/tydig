// What every grant family shares (nih/, nsf/ format it): the facts in
// grant.yaml, an attachment with its page limit, a letter, and a prompt.
//
// Paths here start with "/": a relative path resolves from the file that
// names it (this one, in lib/), not from the document being compiled.
#import "/lib/brand.typ": letterhead
#let G = yaml("/grant.yaml")
#let pi = G.investigators.first()
#let name(p) = p.name + if p.at("degrees", default: none) != none [, #p.degrees]

// What a section asks for, until it is written: grey, so it shows.
#let todo(body) = box(fill: luma(90%), inset: (x: 2pt), outset: (y: 2pt), text(style: "italic")[[#body]])

// One attachment: starts a page, marks its first page for the Makefile
// (which cuts main.typ into separate PDFs) and, over its page limit or with a
// web address in it (funders forbid them where pages are limited), prints a
// red warning on its first page, so the preview says so before the funder does.
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
  show link: it => if limit != none and type(it.dest) == str {
    box(fill: red, inset: 1pt, text(white)[no web addresses here: #it.body])
  } else { it }
  if title != none { align(center, text(12pt, weight: "bold", title)) }
  body
  [#metadata(none)#label(key + "-end")]
}

// A letter, from an entry under letters: in grant.yaml, to the PI.
// On the institution's letterhead when its author is at the institution.
#let letter(l) = {
  pagebreak(weak: true)
  set par(justify: false)
  if l.institution == G.institution.name { letterhead(G.institution) }
  align(right)[#l.date]
  v(1em)
  [#name(pi) \ #pi.title \ #G.institution.name]
  v(1em)
  [Dear Dr. #pi.name.split(" ").last(),]
  parbreak()
  eval(l.body, mode: "markup", scope: (G: G, pi: pi, todo: todo))
  v(1em)
  [Sincerely,]
  if l.at("signature", default: none) != none { image("/" + l.signature, height: 0.5in) } else { v(0.5in) }
  [#l.name \ #l.title \ #l.institution]
}
