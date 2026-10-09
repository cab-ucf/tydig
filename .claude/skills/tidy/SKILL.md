---
name: tidy
description: Tidy a Typst project (grant, paper, report) into tydig's layout so
  it builds, switches template and syncs cleanly. Use when a project was
  imported from a zip or another tool, carries a second layout beside
  tydig's, has side files from a template switch (main.nih-r21.typ,
  Makefile.nih-r25-sepa), or fails `make`.
---

# Tidy a project for tydig

A tydig project is a stack of template layers (`server/templates/`, see
README > Templates) plus the writing. Tidy means: one layout, the
template's; the writing moved into it; nothing else.

1. **Audit.** `.claude/skills/tidy/audit.sh PROJECT TEMPLATE [BRAND]`
   (the template is in `.collab/template.json`, or the side files' suffix,
   or the one most files match). It prints each file as:
   - `same`: the template's, untouched. Leave it: switches update it.
   - `edited`: yours on the template's file. Expected for `grant.yaml`,
     `main.typ`, `budget.yaml`, `refs.bib`; elsewhere (`lib/`, `Makefile`)
     ask why, and restore the template's unless it is a deliberate fix.
   - `missing`: restore it, unless the project's `CLAUDE.md` drops it.
   - `beside`: the new template's version of an `edited` or `own` file.
     Merge the old file's writing into it, then make it the file.
   - `own`: not the template's. Keep notes, README, LICENSE, data,
     figures, scripts. Everything else is a second layout (old section
     files, a private `conf.typ`, packages from `@local/`, other build
     files): move its writing in, then `git rm` it.
2. **Move the writing, never lose it.** Each fact said twice goes into
   `grant.yaml` (title, people, aims, partners, letters); prose into its
   section of `main.typ` or its attachment; a placeholder (`#tbd`, notes)
   becomes `#todo[...]`; names in `budget.yaml` match `grant.yaml`. Merge
   `.bib` files into the one the template cites; drop duplicate keys.
   Unknown facts stay visible: `"[Title]"`, never invented.
3. **Build.** `make` (typst 0.15; `TYPST_FONT_PATHS=fonts/` of tydig) must
   give every attachment in `package.yaml` with no error; then `make full`.
   Look at the first page of each limited section: no red warnings, no
   `lorem`.
4. **Check against tydig's rules**: absolute paths (`/assets/x.svg`), no
   web addresses where pages are limited, nothing generated committed
   (`out/`, `build/`), `.collab/` untouched (the hub's).
5. **Commit small** in a clone (the hub merges it live); in the hub's own
   folder, edit files only and never run git.
