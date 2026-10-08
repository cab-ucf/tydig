# The build graph for this document set. `make` decides what a change
# invalidated: edit prose and only Typst reruns; edit scripts/analysis.py or
# the data and the results, figures, and both PDFs regenerate. Nothing else
# needs to know the difference.
#
# Run from the build panel in the app (it runs these targets in a sandbox
# container), or in any shell with make, python3, and typst on PATH.

PY     := python3
TYPST  := typst

.PHONY: all report summary analysis data clean
.DEFAULT_GOAL := all

all: report summary

report: out/report.pdf
summary: out/summary.pdf
analysis: build/results.json
data: build/data.ok

# ---- 1. data integrity -------------------------------------------------
# Pinned sha256 per input, so every collaborator analyses identical bytes.
# The stamp file is the recorded fact "these inputs verified"; re-verified
# whenever the data or the checker changes.
build/data.ok: data/experiment.csv scripts/fetch_data.py
	@mkdir -p build
	$(PY) scripts/fetch_data.py
	@touch $@

# ---- 2. analysis -------------------------------------------------------
# One run produces several outputs, so this is a grouped target (&:, GNU make
# >= 4.3): make knows a single invocation makes all of them and won't run it
# once per file.
build/results.json figures/cooling.svg &: scripts/analysis.py build/data.ok
	@mkdir -p build figures
	$(PY) scripts/analysis.py

# ---- 3. documents -----------------------------------------------------
# The PDFs depend on the computed results, so a stale number is impossible:
# you cannot produce a report without first producing the values it reads.
out/report.pdf: main.typ build/results.json figures/cooling.svg
	@mkdir -p out
	$(TYPST) compile main.typ $@

out/summary.pdf: summary.typ build/results.json
	@mkdir -p out
	$(TYPST) compile summary.typ $@

clean:
	rm -rf out build figures/cooling.svg
