# One PDF per Research.gov upload, in out/ (make, or make all). main.typ holds
# the Project Description and References Cited together, so citations
# resolve; it is cut where References Cited starts. Each other .typ is an
# upload. make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)
at     = $$($(TYPST) eval 'query(<$(1)>).first().value' --in main.typ)

.PHONY: all full budget budget-import clean
all: out/description.pdf out/references.pdf $(DOCS:%=out/%.pdf)

out/description.pdf out/references.pdf &: main.typ $(DEPS)
	@mkdir -p out
	r=$(call at,references); \
	$(TYPST) compile --no-pdf-tags --pages 1-$$((r-1)) main.typ out/description.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$r- main.typ out/references.pdf

include lib/grant.mk
