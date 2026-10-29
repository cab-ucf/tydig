# ARPA-H EHI application

A Typst project for ARPA-H's Emerging Health Innovators ISO
(ARPA-H-SOL-26-150): one early-career PI (within 8 years of a first terminal
degree), one of 16 topics, a 24-month base ($700,000) and a 12-month
Director's Award option ($350,000), indirect costs included, paid by fixed
milestones a quarter. It is edited live in tydig, so keep each change small.

## When

1. Solution Summary (`summary.typ`, Attachment A): October 30, 2026, 2:00 PM
   ET. Required. ARPA-H answers "encourage" or "discourage", nothing more.
2. Full proposal: February 10, 2027, 2:00 PM ET (questions by February 3):
   `main.typ` (C), `tdd.typ` (D), `payments.typ` (E), `letters.typ`, and
   ARPA-H's own B (pitch slides, 8 minutes) and F (administrative, with each
   key person's Common Forms), filled in from `docs/` and uploaded there.
3. Selection about April 30, 2027; award about June 30, 2027.

All go to https://solutions.arpa-h.gov; questions to EHI2026@ARPA-H.gov.

## Where things are

- `grant.yaml`: every fact stated more than once: title, topic, PI and
  eligibility, team, tasks and their milestones. Change a fact here, never
  in a `.typ` file. `tasks:` drives the summary's plan, the TDD and the
  payment schedule.
- `budget.yaml`: the cost, one entry a year; each year's total is split over
  its milestones' payments unless a milestone sets `amount:`.
- `lib/ehi.typ`: the format, the topics, the cover rows, the blind check and
  the milestone tables; `lib/grant.typ`: `section`, `todo`, `letter`.
- `#todo[...]` (grey) says what a passage must cover.

## Rules

- Letter, 1 in margins, 12 pt (tables, figures and the cover sheet 10 pt).
  Over a page limit a red warning shows: cut text, not format.
- The summary: items 1-3 in two pages, reviewed blind: no names, no
  organizations, no references (FAQ 21). A word that names the team turns
  red; add any other giveaway to `anonymize:`.
- One milestone a quarter, 12 in all, each measurable, not just time passing.
- Subawards and consultants at most 30% of the whole; no co-PIs.
- `proprietary: true` marks each page "Proprietary" (never "Confidential").
- Paths start with `/`.

## Building

`make` builds `out/summary.pdf`, `out/proposal.pdf`, `out/tdd.pdf`,
`out/payments.pdf`, `out/letters.pdf`; `make full` assembles the full
proposal behind a checklist; `make budget` writes `out/budget.xlsx`.
Typst 0.15; python3 with pypdf, openpyxl, ruamel.yaml.

## Git

In a clone, commit and push as usual. In the hub's own folder, edit files
only and never run git there.
