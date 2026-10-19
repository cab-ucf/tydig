# Volume I (main.typ) into out/volume1.pdf, and each other .typ (the solution
# summary, Volume II) into its own PDF, in out/ (make, or make all). make
# full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)

.PHONY: all full budget budget-import clean
all: out/volume1.pdf $(DOCS:%=out/%.pdf)
full budget budget-import clean: # in lib/grant.mk; named here for the build panel

out/volume1.pdf: main.typ $(DEPS)
	@mkdir -p out build
	$(TYPST) compile $(call deps,main) main.typ $@

include lib/grant.mk
