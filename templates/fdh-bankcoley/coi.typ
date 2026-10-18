// Section 26 Q2: Reportable Financial Interests (one PDF). The attestation
// form; the default is no interests requiring disclosure.
#import "/lib/fdh.typ": *
#show: fdh
#section("coi", "Reportable Financial Interests", limit: none)[
  #text(weight: "bold")[Florida Department of Health Financial Conflict of
  Interest in Research] \
  Principal Investigator: #name(pi) \
  Grant Title: #G.title \
  Grant Number: (assigned by the Department)
  #v(0.6em)
  #G.at("coi", default: [☒ The grantee has no financial interests requiring
  disclosure.])
  #v(1.2em)
  #grid(columns: (1fr, 1fr), [#pi.name \ #line(length: 80%) \ Signed],
    [#line(length: 60%) \ Dated])
]
