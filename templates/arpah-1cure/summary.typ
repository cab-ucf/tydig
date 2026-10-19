// The Solution Summary (ISO Appendix A), sent first: ARPA-H's feedback says
// whether to write the full proposal. Four pages in 12 pt framed by the
// first four Heilmeier questions; the cover, target product profiles, key
// personnel, Basis of Estimate and references are outside them.
#import "/lib/arpah.typ": *
#show: arpah.with(vol: "Solution Summary", size: 12, margin: 0.75in)

#cover[Solution Summary]

#section("summary", none, limit: G.limits.summary)[
  = Concept summary
  *What health problem are you trying to solve?* \
  #todo[the objective, with absolutely no jargon] \
  #for a in G.aims [*#a.title.* #a.summary \ ]

  = Innovation and impact
  *How is it done today, and what are the limits of current practice?* \
  #todo[today's radiotherapy and immunotherapy, with numbers, and where they stop @demaria2004]

  *What is new in your approach, and why do you think it will be successful?* \
  #todo[the idea, and the evidence it can work]

  *Who cares? If you succeed, what difference will it make?* \
  #todo[patients, clinics, payers; cost and access in every region]

  #metrics()

  = Proposed work
  #todo[the final deliverables; the approach and the alternatives weighed; new
  developments it needs; risks and their mitigation; the demonstrations]
  #milestones()

  = Team organization and capabilities
  #for p in G.investigators [- *#name(p)*, #p.title, #p.at("organization",
    default: I.name): #p.role. #todo[1–2 sentences of skills and experience]]

  = R&D timeline and cost
  #for (i, p) in G.phases.enumerate() [*#p.name* (months #(edges.at(i) + 1)–#edges.at(i + 1)):
    #p.aim; #money(phased(total).at(i)). ]
  #money(sum(total)) in all.
]

#for (i, t) in G.tpp.enumerate() {
  section("tpp-" + str(i + 1), [Target Product Profile: TA#(i + 1)], limit: G.limits.tpp, tpp(t))
}
#section("personnel", [Key personnel], limit: 1, personnel())
#section("boe", [Basis of Estimate], boe())
#section("references", [References], bibliography("/refs.bib", title: none,
  style: "american-medical-association"))
