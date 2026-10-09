# One PDF per NIH attachment, in out/ (make, or make all); the whole
# application as one, opened by its checklist (make full); the budget as
# Excel (make budget). main.typ holds the Specific Aims, Research Strategy
# and References together, so citations resolve; it is cut at the pages its
# sections mark. Each other .typ is an attachment.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)
at     = $$($(TYPST) eval 'query(<$(1)>).first().value' --in main.typ)

.PHONY: all full budget clean
all: out/aims.pdf out/strategy.pdf out/references.pdf $(DOCS:%=out/%.pdf)

out/aims.pdf out/strategy.pdf out/references.pdf &: main.typ $(DEPS)
	@mkdir -p out
	s=$(call at,strategy); r=$(call at,references); \
	$(TYPST) compile --no-pdf-tags --pages 1-$$((s-1)) main.typ out/aims.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$s-$$((r-1)) main.typ out/strategy.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$r- main.typ out/references.pdf

full: all
	TYPST=$(TYPST) python3 lib/assemble.py

budget: out/budget.xlsx
out/budget.xlsx: budget.yaml lib/budget.typ lib/budget_xlsx.py $(wildcard docs/*.xlsx)
	TYPST=$(TYPST) python3 lib/budget_xlsx.py

out/%.pdf: %.typ $(DEPS)
	@mkdir -p out
	$(TYPST) compile $< $@

clean:
	rm -rf out build
