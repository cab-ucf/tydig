// NSF format (PAPPG 24-1, II.C.2): letter paper, margins of at least 1 in
// with nothing in them, Arial 10 pt or more (Liberation Sans is its metric
// twin, so pages count the same), at most 6 lines per inch (0.55 em leading
// is about 5.3), no page numbers: Research.gov paginates.
#import "/lib/grant.typ": *

#let nsf(body) = {
  set page("us-letter", margin: 1in, numbering: none)
  set text(font: ("Arial", "Liberation Sans"), size: 11pt)
  set par(justify: true, leading: 0.55em, spacing: 0.8em)
  show heading.where(level: 1): set text(12pt)
  show heading: set text(11pt)
  show heading.where(level: 1): set block(above: 1.1em, below: 0.5em)
  show table: set text(10pt)
  show figure.caption: set text(9.5pt)
  body
}
