"""MELD's sentence thresholds, from human writing (one document per file), into calib/:

    python -m perplexiscope.calib human/*.txt"""
import json, sys
from pathlib import Path
import pysbd
from .detect import CAL, Detector

d, seg, xs = Detector(), pysbd.Segmenter(char_span=True), []
for f in sys.argv[1:]:
    t = Path(f).read_text(errors="replace")
    spans = [(z.start + len(w) - len(w.lstrip()), z.start + len(w.rstrip()))
             for z in seg.segment(t) for w in [t[z.start:z.end]]]
    xs += [z["score"] for z in (d(t, spans) or {"sents": []})["sents"] if z]
xs.sort()  # the score a share f of human sentences reach, where 10 or more reach it
pts = [[xs[int(len(xs) * (1 - f))], f] for f in (.1, .05, .01, .001) if len(xs) * f >= 10]
if not pts: sys.exit(f"{len(xs)} sentences scored; calibration needs 100 or more")
CAL.parent.mkdir(exist_ok=True)
CAL.write_text(json.dumps(dict(points=pts, sentences=len(xs), files=len(sys.argv) - 1)))
print(f"{CAL}: {len(xs)} sentences, points {pts}")
