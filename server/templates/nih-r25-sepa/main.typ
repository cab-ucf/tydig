// Specific Aims (1 page), the Research Education Program Plan (25 pages, the
// Research Strategy attachment) and References: one document, so @citations
// resolve, cut into three PDFs by `make`. Facts come from grant.yaml. The
// Plan's parts, and their order, are PAR-27-077's (Section IV); a grey
// [prompt] is what reviewers look for there, until it is written.
#import "/lib/nih.typ": *
#show: nih
#let P = G.program
#let audience = if P.setting == "informal" [informal science education] else [pre-K to 12 classrooms]

#section("aims", "Specific Aims", limit: G.limits.aims)[
  #todo[The gap in research education this program closes, for whom, and the evidence for it @par27077.]

  *The goal* of this #G.mechanism.code, for #P.participants.map(p => lower(p.who)).join(" and ") in
  #audience, is #todo[the change in participants' understanding of biomedical research and its careers].

  #for (i, a) in G.aims.enumerate() [
    *Aim #(i + 1). #a.title.* #a.summary \
  ]

  *Partners:* #P.partners.map(p => [#p.name (#p.role)]).join("; "). \
  *Expected outcome:* #todo[what participants will know and do, and who else can adopt the program].
]

#section("strategy", "Research Education Program Plan", limit: G.limits.strategy)[
  = Proposed Research Education Program
  #todo[Distinct from federally supported training programs; where one runs in the same department, say how.]

  == Rationale
  #todo[The gap in biomedical research education, from the literature and, if you have them, baseline data.]

  == Objectives
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary Measured by #a.measure. \ ]
  #todo[Short- and long-term; evidence-informed; why they matter regionally or nationally, and why
  widely available programs cannot meet them.]

  == Program activities
  #for act in P.activities [
    === #act
    #todo[What participants do, how often, and the sound educational concepts behind it.]
  ]

  == Scientific focus
  #todo[Fit with the missions of the participating NIH Institutes and Centers.]

  = Program Director/Principal Investigator
  #todo[#name(pi): research and/or teaching tied to the NIH mission; organizing, administering,
  monitoring and evaluating the program; administrative arrangements. Multiple PD/PIs: expertise,
  leadership and governance.]

  = Program Faculty
  #for p in G.investigators.slice(1) [*#name(p)*, #p.role: #todo[expertise and history in this role]. \ ]
  #todo[Near-peer mentors, if any: how they are chosen and trained.]

  = Program Participants
  #table(columns: (1fr, auto), stroke: 0.4pt, inset: 4pt, [*Participants*], [*A year*],
    ..P.participants.map(p => ([#p.who], [#p.per_year])).flatten())
  #todo[Why these participants and grade levels; eligibility and selection criteria, consistent with
  applicable law; recruitment, retention and follow-up.]

  = Institutional Environment and Commitment
  #todo[Only what Facilities & Other Resources and the letter of institutional commitment do not say.]

  = Plan for Instruction in the Responsible Conduct of Research
  // Required: without it, the application is not reviewed.
  *Format:* #todo[face to face (online alone is not acceptable)]. *Subject matter:* #todo[topics].
  *Faculty participation:* #todo[who teaches]. *Duration:* #todo[contact hours].
  *Frequency:* #todo[each career stage, at least once every four years].
  #todo[Lab internships: participants' lab-safety training.]

  = Training in Methods for Enhancing Reproducibility
  #todo[How participants learn rigor: design, controls, recording and sharing data (reviewed, though
  Section IV asks for no section).]

  = Evaluation Plan
  #table(columns: (1fr, 1fr, auto), stroke: 0.4pt, inset: 4pt, [*Objective*], [*Measure*], [*Baseline*],
    ..G.aims.map(a => ([#a.title], [#a.measure], [#a.at("baseline", default: todo[baseline])])).flatten())
  #todo[How success is defined and decided; participant feedback; gains in understanding of biomedical
  research and awareness of its careers at each grade level; reported each year.]

  = Dissemination Plan
  #todo[National dissemination, so others can replicate or adapt it: curricula, meetings, workshops.]
  *Website.* #P.website, free and open to all, live within six months of award, its home page
  crediting NIH, NIGMS and SEPA as PAR-27-077 sets out; publications carry the same credit.

  == Timeline
  #table(columns: (auto,) + (1fr,) * (G.years * 2), align: center + horizon,
    [*Aim*], ..range(G.years * 2).map(h => [Y#(calc.quo(h, 2) + 1)H#(calc.rem(h, 2) + 1)]),
    ..G.aims.enumerate().map(((i, a)) => ([Aim #(i + 1)],) + range(G.years * 2).map(_ => [■])).flatten())
]

#section("references", "References Cited")[
  #bibliography("/refs.bib", title: none, style: "american-psychological-association")
]
