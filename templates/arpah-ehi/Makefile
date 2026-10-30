# The proposal (main.typ) into out/proposal.pdf, and each other .typ (the
# solution summary, TDD, payment schedule, letters) into its own PDF, in
# out/ (make, or make all); the summary also into ARPA-H's own template,
# out/summary.docx, the file sent. make full, make budget: lib/grant.mk.

TYPST := typst
DOCS  := $(filter-out main checklist,$(basename $(wildcard *.typ)))
DEPS  := grant.yaml budget.yaml package.yaml refs.bib $(wildcard lib/*.typ assets/*)

.PHONY: all full budget budget-import clean
all: out/proposal.pdf $(DOCS:%=out/%.pdf) out/summary.docx
full budget budget-import clean: # in lib/grant.mk; named here for the build panel

out/proposal.pdf: main.typ $(DEPS)
	@mkdir -p out build
	$(TYPST) compile $(call deps,main) main.typ $@

out/summary.docx: summary.typ grant.yaml lib/ehi.typ lib/attachment_a.py docs/attachment-a.docx
	@mkdir -p out
	python3 lib/attachment_a.py

include lib/grant.mk
