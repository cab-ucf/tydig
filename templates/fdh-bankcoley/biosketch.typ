// Section 26 Q3: Biographical Sketch (NIH format, five pages max), one PDF for
// all key personnel. Each person's bio: block is markup in grant.yaml.
#import "/lib/fdh.typ": *
#show: fdh
#set page(margin: 0.75in)
#for (i, p) in G.investigators.enumerate() [
  #if i > 0 { pagebreak() }
  #text(12pt, weight: "bold")[Biographical Sketch]
  #v(0.3em)
  #grid(columns: (auto, 1fr), row-gutter: 3pt, column-gutter: 8pt,
    [*Name:*], name(p),
    [*Position:*], p.title,
    ..if p.at("commons", default: none) != none { ([*User name:*], p.commons) } else { () })
  #v(0.4em)
  #if p.at("bio", default: none) != none {
    eval(p.bio, mode: "markup", scope: (todo: todo))
  } else { todo[biosketch for #p.name] }
]
