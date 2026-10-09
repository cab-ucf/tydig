// Branding: colours and letterhead. This is the plain default; a brand layer
// (server/templates/brand-<name>/, chosen with the template) replaces this
// file and can add its logo under assets/brand/.
#let primary = rgb("#1f252c")
#let accent = rgb("#1a7f8c")
#let logo = none // a path from the root, e.g. "/assets/brand/logo.svg"

#let letterhead(inst) = {
  grid(columns: (auto, 1fr), column-gutter: 12pt, align: horizon,
    if logo != none { image(logo, height: 0.55in) },
    align(right, text(9pt, fill: primary)[*#inst.name* \ #inst.department \ #inst.address]))
  v(-4pt)
  line(length: 100%, stroke: 1.5pt + accent)
  v(8pt)
}
