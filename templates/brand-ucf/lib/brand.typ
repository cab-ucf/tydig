// UCF branding: black and gold (brand.ucf.edu). The official logo is UCF's
// trademark, so it is not shipped here: download it from brand.ucf.edu, put
// it at assets/brand/logo.svg (or .png), and set logo below.
#let primary = rgb("#000000")
#let accent = rgb("#ffc904") // UCF Gold
#let logo = none // "/assets/brand/logo.svg"

#let letterhead(inst) = {
  grid(columns: (auto, 1fr), column-gutter: 12pt, align: horizon,
    if logo != none { image(logo, height: 0.55in) }
    else { text(15pt, weight: "bold", tracking: 0.04em, fill: primary)[UNIVERSITY OF \ CENTRAL FLORIDA] },
    align(right, text(9pt, fill: primary)[*#inst.department* \ #inst.address]))
  v(-4pt)
  line(length: 100%, stroke: 3pt + accent)
  v(8pt)
}
