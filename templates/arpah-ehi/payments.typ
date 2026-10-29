// The Milestone Payment Schedule (Attachment E): a milestone a quarter,
// each year's cost split over its four unless grant.yaml sets an amount;
// at most $700,000 for the base and $350,000 for the option.
#import "/lib/ehi.typ": *
#show: ehi
#set page(flipped: true)

#align(center)[*ATTACHMENT E \ MILESTONE PAYMENT SCHEDULE* \ Other Transaction Agreement]
#plan-warn
#warn
#table(columns: 4, stroke: 0.5pt, inset: 5pt,
  [*Agency / Office*], [#P.agency / #P.office], [*Agreement No.*], [To be assigned],
  [*Program / Project*], [#P.name / #G.title], [*Performer*], I.name,
  [*Base Period*], [#date(ends(0) + duration(days: 1)) – #date(ends(8))],
  [*Option Period*], [#date(ends(8) + duration(days: 1)) – #date(ends(12))])

= Agreement Value Structure
#table(columns: 3, stroke: 0.5pt, inset: 5pt, align: (left, left, right),
  [*Period*], [*Milestones*], [*FFP Amount*],
  [Two-Year Base Period], [8 quarterly milestones], money(base),
  [Option Year], [4 quarterly milestones], money(option),
  [*Maximum Potential Agreement Value*], [12 milestones], money(base + option))

= 1. Payment and Acceptance Terms
*1.1 Other Transaction (OT) Structure.* This Agreement is structured on a OT
milestone basis. The amounts shown in the Milestone Payment Schedule represent
the fixed amount payable for successful completion and Government acceptance
of the applicable milestone, subject to the terms and conditions of the
Agreement.

*1.2 Milestone Completion.* A milestone is complete when the Performer has
accomplished the work identified for that milestone and submitted the
required deliverable(s), evidence, or other documentation specified in the
schedule.

*1.3 Government Acceptance.* The Government will review the submitted
milestone deliverable(s) against the stated acceptance criteria. Payment
authorization is contingent upon Government acceptance of the milestone in
accordance with the Agreement. If a submission does not satisfy the
acceptance criteria, the Government may identify deficiencies for correction
consistent with the Agreement terms.

*1.4 Invoicing.* Following Government acceptance of a milestone, the
Performer may submit an invoice for the fixed amount associated with that
milestone using the invoicing method and supporting documentation required
by the Agreement.

*1.5 No Payment Based Solely on Time.* Quarterly designations establish the
planned performance sequence and target timing. They do not, by themselves,
establish entitlement to payment. Payment is tied to successful completion
and acceptance of the associated milestone.

*1.6 Option Year.* The Option Year is exercisable solely at the Government's
discretion in accordance with the Agreement. Inclusion of Option Year
milestones in this schedule does not obligate the Government to exercise the
option or fund the associated milestones.

*1.7 Schedule Changes.* Changes to milestone descriptions, target dates,
acceptance criteria, or payment amounts shall be handled in accordance with
the modification procedures established in the Agreement. Any change to
milestone values must preserve the applicable funded and ceiling amounts
unless otherwise modified by the parties.

#for (k, (title, from, to)) in (("2. Base Period - Year 1 Milestones", 1, 4),
  ("3. Base Period - Year 2 Milestones", 5, 8), ("4. Option Year Milestones", 9, 12)).enumerate() {
  heading(title)
  let these = paid.filter(m => from <= m.q.last() and m.q.last() <= to)
  let before = sum(paid.filter(m => m.q.last() < from).map(pay))
  let period = q => if q <= 8 [Base Y#calc.quo(q + 3, 4) - Q#(calc.rem(q - 1, 4) + 1)] else [Option - Q#(q - 8)]
  table(columns: (auto, auto, 1fr, 1fr, 1.2fr, auto, auto, auto), stroke: 0.5pt,
    inset: 4pt, align: (left,) * 6 + (right, right),
    ..([Milestone No.], [Quarter / Period], [Milestone / Task],
      [Required Deliverable / Evidence], [Objective Acceptance Criteria],
      [Target Date], [Amount], [Cumulative Value]).map(strong),
    ..these.map(m => {
      let no = paid.position(x => x == m) + 1
      ([M#str(no + 1000).slice(1)], period(m.q.last()), [#m.name (Task #m.task)],
        m.deliverable, m.metric, date(ends(m.q.last())), money(pay(m)),
        money(sum(paid.slice(0, no).map(pay))))
    }).flatten(),
    table.cell(colspan: 6)[*#("Base Year 1", "Base Year 2", "Option Year").at(k) Total*],
    [*#money(sum(these.map(pay)))*], [*#money(before + sum(these.map(pay)))*])
  if k == 1 [*Two-Year Base Period Total: #money(base)*]
}
#v(0.5em)
*Maximum Potential Agreement Value (Base + Option): #money(base + option)*
