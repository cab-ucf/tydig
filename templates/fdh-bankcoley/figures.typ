// Section 15: Images, Tables, or Graphs, uploaded as one PDF. One block per
// figure; images live under assets/ and are produced by the analysis pipeline
// (see the Makefile `figures` target). Legends come from grant.yaml (figures:).
#import "/lib/fdh.typ": *
#show: fdh
#set page(margin: 0.75in)

#align(center)[#text(13pt, weight: "bold")[Tables, Images, and Graphs] \
  #text(10pt)[#G.title]]
#v(0.5em)

#for (i, f) in G.at("figures", default: ()).enumerate() [
  #block(breakable: false)[
    #if f.at("file", default: none) != none and not f.file.contains("todo") {
      image("/" + f.file, width: 100%)
    } else {
      rect(width: 100%, height: 2in, fill: luma(95%), stroke: 0.5pt,
        align(center + horizon, todo[figure #(i + 1): #f.file]))
    }
    #v(3pt)
    #text(9.5pt)[*Figure #(i + 1).* #f.legend]
  ]
  #v(0.6em)
]
