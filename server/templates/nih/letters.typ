// Letters of Support: one per entry under letters: in grant.yaml, a page each,
// as the single PDF NIH asks for. Send each draft to its author to sign on
// their letterhead, or keep the signature line here.
#import "/lib/nih.typ": *
#show: nih
#set page(margin: 1in)

#for l in G.letters { letter(l) }
