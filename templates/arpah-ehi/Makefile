# The proposal (main.typ) into out/proposal.pdf, and each other .typ (the
# solution summary, TDD, payment schedule, letters) into its own PDF, in
# out/ (make, or make all). make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)

.PHONY: all full budget budget-import clean
all: out/proposal.pdf $(DOCS:%=out/%.pdf)
full budget budget-import clean: # in lib/grant.mk; named here for the build panel

out/proposal.pdf: main.typ $(DEPS)
	@mkdir -p out build
	$(TYPST) compile $(call deps,main) main.typ $@

include lib/grant.mk
