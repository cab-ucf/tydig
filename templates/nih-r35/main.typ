// The Research Strategy (6 pages) and References: one document, so
// @citations resolve, cut into two PDFs by `make`. No Specific Aims page:
// MIRA funds a research program, not a project. The NOFO's headings replace
// Significance, Innovation and Approach; a grey [prompt] is what reviewers
// look for there, until it is written.
#import "/lib/nih.typ": *
#show: nih

#section("strategy", "Research Strategy", limit: G.limits.strategy)[
  = Background
  #todo[The main research area(s), and the key gaps in understanding or major challenges the program
  will address. About a page.]

  = Recent progress
  #let skills = if G.mechanism.at("esi", default: false) [, technical expertise and skills such as mentoring included]
  #todo[What #pi.name has accomplished in the past five years#skills. Not what the biosketch already says. About a page.]

  = Overview of future research plans
  #todo[The key questions or challenges of the next five years, why they matter, and the general
  strategies; no detailed experimental plans. A single theme is not expected. Three to four pages.]
  #for d in G.directions [
    == #d.title
    #d.question #todo[general strategy; what makes it feasible]
    _(About #d.effort% of the program's effort and resources.)_
  ]

  #let total = G.directions.map(d => d.effort).sum(default: 0)
  #if total != 100 { box(fill: red, inset: 2pt, text(white)[directions: their effort adds to #total%, not 100%]) }

  #todo[How the directions are distinct or complementary; rigor and transparency; sex as a biological
  variable.]
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: "american-psychological-association")
]
