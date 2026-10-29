// The Solution Summary (Attachment A), due October 30, 2026, 2:00 PM ET, on
// solutions.arpa-h.gov: required to send a full proposal. The cover sheet
// carries every name; items 1-3, two pages at most, are reviewed blind (a
// name there turns red) and cite no references (FAQ 21).
#import "/lib/ehi.typ": *
#show: ehi

#section("cover", none)[
  #set page(numbering: none)
  #align(center)[*Solution Summary Cover Sheet*]
  #rows(
    ("EHI ISO #", P.call),
    ("EHI Topic Area (Number and Title)", topic),
    ("Solution Summary Title", G.title),
    ("Prime Organization", I.name),
    ("Prime Organization Type", types(I.types)),
    ("SAM.gov Unique Entity Identifier (UEI)", I.uei),
    ("Technical Point of Contact (POC)/Principal Investigator (PI)", poc(pi + (name: name(pi)))),
    ([PI's date of completion of terminal degree \ #text(9pt)[(Eligibility
      requires the PI to be within 8 years of completion of first terminal
      degree)]], [#pi.terminal#if "excluded" in pi [ \ Excluded: #pi.excluded]]),
    ([I certify that the PI is eligible per Section 2.6 of the ISO (leaves of
      absence, post doctoral, residency, and fellowship periods can be
      excluded for determination of eligibility).], pi.eligible),
    ("Administrative POC", [Name: #I.admin.name \ Telephone: #I.admin.phone \
      Email: #I.admin.email]),
    ("Other Team Members (subawardees and consultants), if any",
      if team == () [None] else { team.map(p => [Technical POC Name: #p.name \
        Organization: #p.organization \ Organization Type: #p.orgtype])
        .join(v(0.5em)) }),
    ("Date Solution Summary was prepared", G.dates.summary))
]

#section("summary", none, limit: 2, blind[
  #counter(page).update(1)
  #align(center)[*SOLUTION SUMMARY*]
  *EHI Topic Area (Number and Title):* #topic \
  *Solution Summary Title:* #G.title

  = 1. Define the problem
  #todo[What health problem will your project solve? What is the current
  benchmark (standards of care or state-of-the-art approaches), with numbers?
  What is the impact of solving it?]

  = 2. Explain your solution
  #todo[What is your solution? What technical challenges must be overcome or
  breakthroughs achieved to enable it? What makes it plausible yet
  revolutionary: the underlying technical innovation?]

  = 3. Present your plan
  #todo[The key steps to develop and de-risk the solution, each needing the
  last, from where you start to the goal.]
  #plan()
])
