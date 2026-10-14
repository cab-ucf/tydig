# One PDF per NIH attachment, in out/ (make, or make all). main.typ holds the
# Research Strategy and References together, so citations resolve; it is cut
# where References start (a MIRA has no Specific Aims). Each other .typ is an
# attachment. make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)
at     = $$($(TYPST) eval 'query(<$(1)>).first().value' --in main.typ)

.PHONY: all full budget budget-import clean
all: out/strategy.pdf out/references.pdf $(DOCS:%=out/%.pdf)

out/strategy.pdf out/references.pdf &: main.typ $(DEPS)
	@mkdir -p out
	r=$(call at,references); \
	$(TYPST) compile --no-pdf-tags --pages 1-$$((r-1)) main.typ out/strategy.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$r- main.typ out/references.pdf

include lib/grant.mk
