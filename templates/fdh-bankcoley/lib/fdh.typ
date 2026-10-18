// Florida DOH Bankhead-Coley format. PeerNet imposes no page or font rule on
// the online text boxes; the uploaded attachments (work plan, figures,
// bibliography, biosketch, budget) are what this formats. US letter, 11 pt,
// Libertinus Serif (built into Typst, so the container needs no font install).
#import "/lib/grant.typ": *
#import "/lib/brand.typ": accent, primary

#let fdh(body) = {
  set page("us-letter", margin: 1in)
  set text(font: "Libertinus Serif", size: 11pt)
  set par(justify: true, leading: 0.55em)
  set block(spacing: 1em)
  show heading: set text(11pt)
  show heading.where(level: 1): it => block(above: 1.1em, below: 0.6em,
    text(fill: accent, weight: "bold", upper(it.body)))
  body
}
