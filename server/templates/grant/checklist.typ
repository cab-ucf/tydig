// The checklist: every component, where it comes from, and whether it is
// here. `make full` opens the whole application with it, told what exists.
#import "/lib/format.typ": *
#import "/lib/package.typ": items
#show: format
#let present = sys.inputs.at("present", default: none)
#let present = if present != none { json(bytes(present)) }
#let when = (always: [required], applicable: [if applicable], jit: [just-in-time], resubmission: [resubmissions], revision: [revisions], renewal: [renewals])

#section("checklist", [#G.mechanism.code application: checklist], limit: none)[
  #G.title \ #text(9pt)[#name(pi), #G.institution.name. #if present == none [Run `make full` to check what is here.]]
  #v(0.5em)
  #set text(9pt)
  #table(columns: (auto, 1fr, auto, auto), stroke: 0.4pt, inset: 4pt,
    [], [*Component*], [*Needed*], [*From*],
    ..items.map(i => {
      let w = i.at("when", default: "always")
      let f = i.at("file", default: none)
      let mark = if f == none [form] else if present == none [] else if i.id in present [✓] else if w == "always" [#text(red)[*✗*]] else [–]
      (mark, [#i.name #if "limit" in i [(#i.limit)]], when.at(w), if f == none [#i.at("from", default: [])] else if f.starts-with("out/") [built] else [upload])
    }).flatten())
]
