# One PDF per attachment, in out/ (make, or make all). main.typ holds the
# sections that cite (aims, strategy, references...), so citations resolve;
# each section() in it, wherever it falls, is cut into out/<key>.pdf. Each
# other .typ is an attachment. make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)
CUT    = query(<cut>).map(m => (m.value, m.location().page(), \
  query(label(m.value + "-end")).first().location().page()).map(str).join(" "))

.PHONY: all full budget budget-import clean
all: build/main.pdf $(DOCS:%=out/%.pdf)
full budget budget-import clean: # in lib/grant.mk; named here for the build panel

build/main.pdf: main.typ $(DEPS)
	@mkdir -p out build
	$(TYPST) eval '$(CUT)' --in main.typ --format yaml > build/cut
	sed -n 's/^- //p' build/cut | while read k a b; do $(TYPST) compile \
	  --no-pdf-tags --pages $$a-$$b main.typ out/$$k.pdf || exit; done
	$(TYPST) compile $(call deps,main) main.typ $@

include lib/grant.mk
out/%.pdf: build/main.pdf ;
