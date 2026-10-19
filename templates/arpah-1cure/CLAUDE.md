# ARPA-H 1-CURE proposal

A Typst project for ARPA-H's 1-CURE Innovative Solutions Opening
(ARPA-H-SOL-26-147): FLASH radiotherapy with immunogenic smart radiotherapy
biomaterials (TA1) and an abscopal treatment planning system (TA2), both in
one proposal, over 60 months in three phases. It is edited live in tydig, so
keep each change small.

## Where things are

- `grant.yaml`: every fact stated more than once: title, people, phases,
  metrics, tasks, target product profiles, IP. Change a fact here, never in a
  `.typ` file. `tasks:` drives the milestones, the Task Description Document
  and the schedule.
- `summary.typ`: the Solution Summary, sent first (4 pages, 12 pt; the
  cover, TPPs, key personnel, Basis of Estimate and references outside).
- `main.typ`: Volume I (sections A-F within 20 pages; G-K outside).
- `volume2.typ`: Volume II, the cover, Basis of Estimate and cost support.
  ARPA-H's cost spreadsheet, Volume III (with biosketches) and Volume IV are
  ARPA-H's own templates: fill them in and upload to `docs/`.
- `budget.yaml`: the cost inputs, one entry a year; `lib/arpah.typ` splits
  the years into phases by the months they share. Never type a total.
- `lib/arpah.typ`: the format and the shared tables; `lib/grant.typ`:
  `section`, `todo`.
- `#todo[...]` (grey) says what a passage must cover; a blank TPP row is one.

## Rules

- Arial (or sans serif) 11 pt or larger, 1 in margins, page numbers; the
  summary 12 pt. Over a page limit a red warning shows: cut text, not format.
- Quantitative milestones a phase, against 1-CURE's metrics (ISO 2.5).
- Paths start with `/`. Mark proprietary pages as the ISO says.

## Building

`make` builds `out/summary.pdf`, `out/volume1.pdf`, `out/volume2.pdf`;
`make full` assembles the volumes behind a checklist; `make budget` writes
`out/budget.xlsx`. Typst 0.15; python3 with pypdf, openpyxl, ruamel.yaml.

## Git

In a clone, commit and push as usual. In the hub's own folder, edit files
only and never run git there.
