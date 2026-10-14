#!/usr/bin/env python3
"""Data provenance gate: every collaborator analyses byte-identical inputs.

For bundled data this verifies the pinned sha256. For remote data, replace
the body with pooch (preinstalled in the sandbox image):

    import pooch
    pooch.retrieve(url="https://lab.example.edu/run42.csv",
                   known_hash="sha256:<pin>", path="data",
                   fname="experiment.csv")

Either way, a hash mismatch fails the build -- results can never be computed
from silently changed data.
"""
import hashlib, sys
from pathlib import Path

PINS = {
    "data/experiment.csv":
        "88ba2c40ce491cfe857d36b773e1e38ef2557dd21f6d5ef47d5ba045ce3917e0",
}

bad = False
for rel, want in PINS.items():
    p = Path(rel)
    if not p.exists():
        print(f"MISSING  {rel}", file=sys.stderr); bad = True; continue
    got = hashlib.sha256(p.read_bytes()).hexdigest()
    ok = got == want
    print(f"{'OK      ' if ok else 'MISMATCH'} {rel}", file=sys.stderr)
    if not ok:
        print(f"  pinned {want}\n  actual {got}", file=sys.stderr); bad = True
sys.exit(1 if bad else 0)
