// The letter of support from an organization official, required with the
// full proposal (FAQ 8): one per entry under letters: in grant.yaml. Send
// the draft to its author to sign on their letterhead.
#import "/lib/ehi.typ": *
#show: ehi
#set page(header: none, numbering: none)

#for l in G.at("letters", default: ()) { letter(l) }
