# What every grant family's Makefile shares: the whole application as one,
# opened by its checklist (make full); the budget as Excel (make budget), or a
# filled-in one read back (make budget-import); and one PDF per attachment.

full: all
	TYPST=$(TYPST) python3 lib/assemble.py

budget: out/budget.xlsx
out/budget.xlsx: budget.yaml lib/budget.typ lib/budget_xlsx.py $(wildcard budget-excel.yaml docs/*.xlsx)
	TYPST=$(TYPST) python3 lib/budget_xlsx.py

# a filled-in workbook (upload it as docs/budget-filled.xlsx) back into budget.yaml
FILLED ?= docs/budget-filled.xlsx
budget-import:
	TYPST=$(TYPST) python3 lib/budget_xlsx.py import $(FILLED)

out/%.pdf: %.typ $(DEPS)
	@mkdir -p out
	$(TYPST) compile $< $@

clean:
	rm -rf out build
