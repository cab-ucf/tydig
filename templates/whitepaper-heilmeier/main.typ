// A white paper in the Heilmeier Catechism's eight questions, each a heading
// (DARPA's, and ARPA-H's, IARPA's and ARPA-E's alike). The page limit is the
// call's (limits.body); references are outside it. A grey [prompt] is what
// the program manager looks for there, until it is written.
#import "/lib/whitepaper.typ": *
#show: whitepaper

#section("body", none, limit: G.limits.body)[
  #titleblock()
  = What are you trying to do?
  #todo[The objective in plain words, without jargon: a reader outside the field gets it in a paragraph.]
  #for (i, a) in G.aims.enumerate() [*#(i + 1). #a.title.* #a.summary \ ]

  = How is it done today, and what are the limits of current practice?
  #todo[Today's best, with numbers, and exactly where it stops.]

  = What is new in your approach, and why do you think it will be successful?
  #todo[The one idea that is new, and the evidence that it can work @heilmeier1992.]

  = Who cares? If you are successful, what difference will it make?
  #todo[Who uses it, what they can do then that they cannot now, and how much it matters.]

  = What are the risks?
  #todo[The biggest technical risks, how likely each is, and how the plan retires them early.]

  = How much will it cost?
  #rom()

  = How long will it take?
  #todo[The phases, and what each delivers.] #G.years years, as below.

  = What are the mid-term and final "exams" to check for success?
  #milestones()
]

#section("references", "References")[
  #bibliography("/refs.bib", title: none, style: "ieee")
]
