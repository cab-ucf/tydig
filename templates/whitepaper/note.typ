// The note that carries the white paper: the email to the program manager,
// to paste, with the white paper attached. Short; it asks for a conversation.
#import "/lib/whitepaper.typ": *
#show: whitepaper

#section("note", none, limit: 1)[
  Subject: White paper: #G.title

  Dear #P.manager,

  #todo[One sentence on who you are and why you are writing to them, and not someone else.]
  Attached is a #G.at("pages", default: [short]) #lower(G.mechanism.code), "#G.title", for #P.name#if "call" in P [ under #P.call].
  #todo[One or two sentences: the idea, and what it would make possible.]

  Would you have twenty minutes in the next few weeks to tell us whether it fits your program, and
  what would make it fit better?

  With thanks, \
  #name(pi) \ #pi.title, #G.institution.department, #G.institution.name \ #pi.email
]
