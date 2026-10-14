// Letters of Collaboration: one for each unfunded collaborator under
// collaborators: in grant.yaml, in NSF's own sentence and nothing more (a
// letter of support can get the proposal returned). Each signs on their letterhead.
#import "/lib/nsf.typ": *
#show: nsf

#for c in G.at("collaborators", default: ()) {
  pagebreak(weak: true)
  align(right, c.at("date", default: todo[date]))
  v(1em)
  [If the proposal submitted by Dr. #pi.name entitled "#G.title" is selected for funding by NSF, it is my
  intent to collaborate and/or commit resources as detailed in the Project Description or the Facilities,
  Equipment and Other Resources section of the proposal.]
  v(2em)
  [#c.name \ #c.title \ #c.organization]
}
