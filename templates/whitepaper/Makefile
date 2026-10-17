# The white paper (main.typ) into out/whitepaper.pdf, and each other .typ
# (the note to the program manager) into its own PDF, in out/ (make, or make
# all). make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)

.PHONY: all full budget budget-import clean
all: out/whitepaper.pdf $(DOCS:%=out/%.pdf)

out/whitepaper.pdf: main.typ $(DEPS)
	@mkdir -p out
	$(TYPST) compile main.typ $@

include lib/grant.mk
