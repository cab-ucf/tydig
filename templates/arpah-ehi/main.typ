// The Technical and Management Proposal (Attachment C), due February 10,
// 2027, 2:00 PM ET: sections 1-4 within eight pages; the cover, team table,
// contents and bibliography outside them. Only what it asks: the rest, as
// links in the bibliography.
#import "/lib/ehi.typ": *
#show: ehi

#let cost = sum(budget.total)
#section("cover", none)[
  #set page(numbering: none)
  #align(center)[*Technical and Management Proposal*]
  #rows(
    ("EHI ISO #", P.call),
    ("EHI Topic Area (Number and Title)", topic),
    ("EHI Proposal Title", G.title),
    ("Proposer Organization Name", I.name),
    ("Type of Organization", types(I.types)),
    ("SAM.gov Universal Entity Identifier (UEI)", I.uei),
    ("Proposer's EHI Executive Summary Reference Number",
      if G.reference == none { todo[from the Solutions site] } else { G.reference }),
    ("Technical Point of Contact (TPOC)", poc(pi + (name: name(pi)),
      address: "Mailing Address")),
    ("Administrative POC (APOC)", poc(I.admin,
      address: "Mailing Address")),
    ("Total Proposed Cost", [#money(cost) (base #money(base), option
      #money(option))]),
    ("Place(s) of Performance", G.places.join[; ]),
    ("Date of Proposal Submission", G.dates.proposal),
    ([Proposal's Validity Period \ (minimum 120 days)], G.validity))
  #v(1em)
  #table(columns: (2fr, 3fr), stroke: 0.5pt, inset: 5pt,
    table.cell(colspan: 2)[*SUB-AWARDEE AND CONSULTANT TEAM MEMBERS*],
    ..if team == () { (table.cell(colspan: 2)[None],) } else {
      team.enumerate().map(((i, p)) => (
        [*#(i + 1). Organization Name:*], p.organization,
        [Technical POC], [Name: #p.name \ Telephone: #p.phone \ Email: #p.email],
        [Organization Type:], types((p.orgtype,)))).flatten() })
]

#section("contents", none)[
  #set page(numbering: none)
  #outline(title: [Table of Contents], depth: 1)
  #counter(page).update(0)
]

#section("body", none, limit: 8)[
  = 1. Proposal Summary
  == A. Discussion
  + *What is the intended work?* \ #todo[in plain words]
  + *How does it lead to improved health outcomes or more reliable health
    systems?* \ #todo[answer]
  + *How is it done today, and what are the limits of present approaches?* \
    #todo[with numbers]
  + *What is new in your approach? Why will it succeed now?* \ #todo[answer]
  + *What are the key technical, programmatic and translational risks, and
    their mitigation?* \ #todo[answer]
  + *Who or what will be affected, and what will the impact be?* \ #todo[answer]
  + *What are the specific applications?* \ #todo[answer]
  + *How will cost, accessibility and user experience be addressed, so all
    people have access?* \ #todo[answer]
  + *How might this effort be misperceived or misused, and how will you
    prevent it?* \ #todo[answer]
  #todo[The key technical challenges, the technologies to overcome them, and
  the novelty of the work; about 2 pages in all]

  = 2. Goals and Impact
  #todo[The difference it makes if successful, qualitatively and
  quantitatively; what is innovative against existing capabilities; its
  relation to past and present projects; plans and risks for access and
  adoption; the specific outcomes]

  = 3. Technical Plan
  #todo[A credible plan to the goal, high risk and high reward; about 5 pages]
  #for (i, t) in G.tasks.enumerate() [
    == Task #(i + 1): #t.title
    #todo[the technical challenges and how they will be overcome; the
    alternatives if they are not#if t.subjects != "No" [; the IRB or IACUC
    review and approval plan]]
  ]
  #plan()

  = 4. Capabilities/Management Plan
  #todo[The team's expertise and the organization of its work; about 1 page]
  #table(columns: (auto, 1fr, 1fr), stroke: 0.5pt, inset: 4pt,
    [*Name*], [*Organization*], [*Role and responsibilities*],
    ..G.investigators.map(p => (name(p), p.at("organization", default: I.name),
      p.role)).flatten())
]

#section("bibliography", none)[
  = 5. Bibliography
  #todo[each key person's qualifications (a resume); links to papers, reports]
  #bibliography("/refs.bib", title: none, style: "american-medical-association")
]
