// One-page summary compiled from the SAME results.json as the full report:
// two documents, one source of truth, zero copy-paste drift.
#let R = json("build/results.json")
#let f(x, d: 2) = str(calc.round(x, digits: d))
#set page(paper: "a5", margin: 1.5cm)
= Executive summary
Over #R.n minutes the sample went from #f(R.T1) to #f(R.T2) #sym.degree\C and
was therefore
*#if R.direction == "cooling" [cooling] else if R.direction == "heating" [heating] else [thermally constant]*
#if R.conclusive [(above the pre-registered noise threshold).] else [(below the pre-registered noise threshold -- no claim is made).]
#if R.newton != none [Time constant: #f(R.newton.tau_min, d: 1) min.]
