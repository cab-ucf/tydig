# White paper

A Typst project for a white paper to a program manager: a short case for an
idea, sent before (or instead of) a full proposal. Program managers ask for
different things, so the style is the template's (Heilmeier for DARPA-like
agencies, a DoD service BAA's, a two-page concept for a program officer), and
the call (`program.call:` in `grant.yaml`) decides over it. It is edited live
by people in tydig while you work, so keep each change small and focused.

## Where things are

- `grant.yaml`: every fact stated more than once (title, people, the
  program manager, objectives, milestones, the format the call asks for).
  Change a fact here, never in the `.typ` files.
- `main.typ`: the white paper, with its references. Its `body` section
  carries the page limit (`limits.body`); a cover page and the references
  are outside it, as calls usually count.
- `#todo[...]` (grey) says what a passage must cover. Replace it with the
  text; never leave one in a finished section.
- `note.typ`: the email that carries it, to paste. Short; it asks for a
  conversation, not a decision.
- `budget.yaml`: the inputs of the rough order of magnitude (ROM) cost;
  `lib/budget.typ` computes the totals and `rom()` tabulates them. Never type
  a total into a `.typ` file.
- `lib/whitepaper.typ`: the format (`format:` in `grant.yaml`: font, size,
  page numbers), the title block, `rom()` and `milestones()`.
- `refs.bib`: references; cite them as `@key` in `main.typ`.
- `package.yaml`: what is sent, for the Checklist panel and `make full`.

## Rules

- Write for one reader, the program manager: plain words first, jargon never
  without need; what changes if it works, and how anyone will know.
- Match the call: its page limit (`limits.body`), font and size (`format:`),
  and any headings it names. Over the limit, a red warning shows: shorten
  the text, never the format.
- Paths start with `/` (`image("/assets/x.svg")`).
- Nothing proprietary or export-controlled unless the call says how to mark
  it.

## Building

`make` builds `out/whitepaper.pdf` and `out/note.pdf`; `make full` puts what
is sent together with a checklist page; `make budget` writes the budget into
`out/budget.xlsx`. It needs `typst` 0.15 on PATH.

## Git

If you work in a clone of the project's repository, commit and push as
usual: the hub merges your change into the live text. If you work in the
hub's own folder (`<data folder>/<project>/`), edit files only and never run
git there: that history belongs to the hub.
