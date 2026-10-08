# One PDF per NIH attachment, in out/. main.typ holds the Specific Aims,
# Research Strategy and References together, so citations resolve; it is
# cut at the pages its sections mark. Each other .typ is an attachment.

TYPST := typst
DOCS  := $(filter-out main,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml refs.bib $(wildcard lib/*.typ assets/*)
at     = $$($(TYPST) eval 'query(<$(1)>).first().value' --in main.typ)

.PHONY: all clean
all: out/aims.pdf out/strategy.pdf out/references.pdf $(DOCS:%=out/%.pdf)

out/aims.pdf out/strategy.pdf out/references.pdf &: main.typ $(DEPS)
	@mkdir -p out
	s=$(call at,strategy); r=$(call at,references); \
	$(TYPST) compile --no-pdf-tags --pages 1-$$((s-1)) main.typ out/aims.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$s-$$((r-1)) main.typ out/strategy.pdf && \
	$(TYPST) compile --no-pdf-tags --pages $$r- main.typ out/references.pdf

out/%.pdf: %.typ $(DEPS)
	@mkdir -p out
	$(TYPST) compile $< $@

clean:
	rm -rf out
