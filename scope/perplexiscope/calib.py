"""MELD's thresholds for sentences, and the typical range for documents below MELD's own,
from human writing (one document per file), into calib/:

    python -m perplexiscope.calib human/*.txt"""
import json, sys
from pathlib import Path
import pysbd
from .detect import CAL, Detector

d, seg, xs, ds = Detector(), pysbd.Segmenter(char_span=True), [], []
for f in sys.argv[1:]:
    t = Path(f).read_text(errors="replace")
    spans = [(z.start + len(w) - len(w.lstrip()), z.start + len(w.rstrip()))
             for z in seg.segment(t) for w in [t[z.start:z.end]]]
    r = d(t, spans) or {"sents": []}
    xs += [z["score"] for z in r["sents"] if z]; ds += [r["score"]] if "score" in r else []
# the score a share f of human texts reach, where 10 or more reach it
at = lambda v, fs: [[sorted(v)[int(len(v) * (1 - f))], f] for f in fs if len(v) * f >= 10]
pts = at(xs, (.5, .25, .1, .05, .01, .001))
if len(pts) < 3: sys.exit(f"{len(xs)} sentences scored; calibration needs 100 or more")
CAL.parent.mkdir(exist_ok=True)
CAL.write_text(json.dumps(dict(points=pts, doc=at(ds, (.5, .25)), sentences=len(xs), files=len(ds))))
print(f"{CAL}: {len(xs)} sentences, points {pts}")
