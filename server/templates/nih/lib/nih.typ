// NIH format (SF424 R&R guide): US letter, margins of at least half an inch,
// 11 pt or larger in Arial, Helvetica, Palatino Linotype or Georgia (Liberation
// Sans is Arial's metric twin), no more than six lines per inch, and no headers,
// footers or page numbers: NIH stamps its own.
#import "/lib/grant.typ": *

#let nih(body) = {
  set page("us-letter", margin: 0.5in)
  set text(font: "Liberation Sans", size: 11pt)
  set par(justify: true, leading: 0.5em)
  set block(spacing: 0.9em)
  show heading: set text(11pt)
  show heading.where(level: 1): set block(above: 1em, below: 0.6em)
  // words the funder forbids (a MIRA withdraws an application that says "aims")
  show: b => G.mechanism.at("forbid", default: ()).fold(b, (b, w) => {
    show regex("(?i)\\b" + w + "\\b"): it => box(fill: red, inset: 1pt, text(white)[#it (#G.mechanism.code forbids this word)])
    b
  })
  body
}
