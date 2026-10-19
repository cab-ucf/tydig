// Volume I, Technical and Management Proposal (ISO Appendix B): sections
// A–F within twenty pages; the cover, Task Description Document, target
// product profiles, schedule, data plan and references outside them.
#import "/lib/arpah.typ": *
#show: arpah.with(vol: "Volume I")

#cover[Volume I, Technical and Management Proposal]

#section("body", none, limit: G.limits.volume1)[
  = A. Executive summary
  + *What is the proposed work attempting to accomplish or solve?* \
    #todo[in plain words]
  + *How is it done today? What are the limitations of present approaches?* \
    #todo[and the competitive landscape @demaria2004]
  + *What are the key technical challenges, and how will you overcome them?* \
    #todo[each, and its answer]
  + *What is new about your approach? Why can you succeed now?* \
    #todo[who benefits; which health outcomes it accelerates]
  + *Who cares? If you succeed, what difference will it make?* \
    #todo[for patients, clinics and payers, in every region]
  + *What are the risks?* \
    #todo[to your objectives and from the program; their mitigation]
  + *How much will your project cost?* #money(sum(total)): #G.phases.enumerate().map(((i, p)) =>
    [#p.name #money(phased(total).at(i))]).join(", ").
  + *What are your milestones to check for success?* #metrics()

  = B. Solution fit with 1-CURE
  #todo[what it achieves against 1-CURE's vision and metrics; prior R&D and its
  barriers; what is revolutionary; deliverables; how it fits the clinical workflow]

  = C. Technical plan
  #for a in G.aims [
    == #a.title
    #todo[#a.summary The challenges, the plan, its alternatives and risks.]
  ]
  == Process flow of the final system
  #todo[a simple diagram: SRB injection, FLASH-RT planned by the ATPS, response]
  == Milestones
  #milestones()

  = D. Management plan
  #todo[the PI; the Project Manager/Integrator; the organization by TA (an
  organization chart); coordination and data sharing; teaming agreements; risk management]
  #effort()

  = E. Capabilities
  #todo[experience, existing IP, facilities and access, biosafety; related work]

  = F. Commercialization plan
  #todo[the market and its size; 2–3 competing technologies and their limits;
  ownership of IP; partners for funding, manufacturing and marketing]
  #iptable()
]

#section("tdd", [G. Task Description Document], tdd())
#for (i, t) in G.tpp.enumerate() {
  section("tpp-" + str(i + 1), [H. Target Product Profile: TA#(i + 1)], limit: G.limits.tpp, tpp(t))
}
#[
  #set page(flipped: true)
  #section("schedule", [I. Schedule and milestones], schedule())
]
#section("dmsp", [J. Data Management and Sharing Plan], limit: G.limits.dmsp)[
  #for e in ("Data type", "Related tools, software and code", "Standards",
    "Data preservation, access and timelines", "Access, distribution and reuse",
    "Oversight of data management and sharing") [*#e.* #todo[NIH's element] \ ]
]
#section("references", [K. References], bibliography("/refs.bib", title: none,
  style: "american-medical-association"))
