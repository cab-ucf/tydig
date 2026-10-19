// Volume II, Cost Proposal: the cover, the Basis of Estimate by phase, and a
// page of cost and pricing support. ARPA-H's cost spreadsheet goes with it
// (package.yaml); `make budget` gives these numbers as Excel to copy in.
#import "/lib/arpah.typ": *
#show: arpah.with(vol: "Volume II")

#cover[Volume II, Cost Proposal]
#section("boe", [Basis of Estimate], boe())
#section("support", [Cost and pricing data support], limit: 1)[
  #todo[the basis of each rate (fringe, indirect at #(B.rates.fa * 100)%), the
  subawards and how they were priced, quotes for equipment and materials]
]
