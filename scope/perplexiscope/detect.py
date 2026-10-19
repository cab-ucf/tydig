"""How AI-like each sentence and the whole text read, from MELD [li2026meld]: an open (MIT)
encoder trained on 10M human and AI texts from 78 generators, the strongest open detector on
RAID's hidden test set [dugan2024raid]. Its authors measure 99.7% TPR at 1% FPR on current chat
models, where likelihood detectors (Fast-DetectGPT, Binoculars) reach 17% and 0.6%.

A score is MELD's top-quarter mean of its token scores. The document's is compared with the
thresholds MELD set on 22,190 human documents; a sentence's with human sentences, once
calibrated (calib.py). Either way the result is how rare the score is among human writing,
never a probability that the text is AI."""
import importlib.util, json
from bisect import bisect_left
from difflib import SequenceMatcher
from pathlib import Path
import torch
from huggingface_hub import snapshot_download

REPO, REV = "anon-review-meld-2026/meld", "8990324abd92e1fa17072f6887ea1e5c1cef5abc"
CAL = Path(__file__).parent / "calib" / "meld-sentences.json"
MIN_TOKENS = 8  # shorter sentences are not judged


def meld(path):  # MELD's own code at the pinned commit, so scores mean what its thresholds say
    spec = importlib.util.spec_from_file_location("meld", Path(path, "meld.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def align(a, b):  # for each character of a, where in b it came from (MELD strips markup)
    if a == b: return list(range(len(a)))  # nothing stripped: no quadratic diff
    out = [-1] * len(a)
    for x, y, k in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        out[x:x + k] = range(y, y + k)
    for i in range(len(out)): out[i] = out[i] if out[i] >= 0 else (out[i - 1] if i else 0)
    return out


def tail(x, pts):  # share of human texts scoring at least x, log-interpolated in [score, share]
    if x <= pts[0][0]: return max(pts[0][1], .5)  # below every threshold: typical
    for (a, p), (b, q) in zip(pts, pts[1:]):
        if x < b: break
    return max(1e-3, p * (q / p) ** ((x - a) / (b - a)))  # past the last: its slope, to 1 in 1,000


class Detector:
    def __init__(s, path=None, device=None):
        path = path or snapshot_download(REPO, revision=REV)
        s.M = meld(path); s.sc = s.M.Scorer(path, device)
        cut = s.sc.cfg["score_offsets"]["overall"]
        cal = json.loads(CAL.read_text()) if CAL.exists() else {}
        s.doc_pts = [[cut[f"fpr_{f}"], f] for f in (.1, .05, .01)]  # below MELD's: our human documents'
        s.doc_pts = [p for p in cal.get("doc", []) if p[0] < s.doc_pts[0][0]] + s.doc_pts
        s.sent_pts = cal.get("points")
        s.last = None

    def tq(s, v): return s.M.top_quantile_mean(v, s.sc.rho)

    @torch.no_grad()
    def __call__(s, text, spans=()):  # spans: (start, end) characters of each sentence in text
        key = text, tuple(map(tuple, spans))
        if s.last and s.last[0] == key: return s.last[1]
        canon, sc = s.M.canonicalize(text), s.sc
        e = sc.tok(canon, add_special_tokens=False, return_offsets_mapping=True)
        ids, off = e.input_ids[:sc.cap], e.offset_mapping[:sc.cap]
        if not ids: return None
        f, c, o = [], [], []
        for i in range(0, len(ids), sc.window):  # MELD's contract: disjoint windows, CLS/SEP, fp32
            x = torch.tensor([[sc.cls_id, *ids[i:i + sc.window], sc.sep_id]], device=sc.device)
            for acc, t in zip((f, c, o), sc.model.token_scores(x, torch.ones_like(x))):
                acc.append(t[0, 1:-1].cpu())
        f, c, o = torch.cat(f), torch.cat(c), torch.cat(o)
        pos = align(canon, text); at = [pos[a] for a, _ in off]
        score = float(s.tq(c))
        r = dict(score=score, tail=tail(score, s.doc_pts), words=len(canon.split()),
                 calibrated=s.sent_pts is not None, sents=[],
                 family=sc.cfg["families"][int(s.tq(f).argmax())],
                 task=sc.cfg["ops"][int(s.tq(o).argmax())])
        for a, b in spans:
            lo, hi = bisect_left(at, a), bisect_left(at, b)
            x = float(s.tq(c[lo:hi])) if hi - lo >= MIN_TOKENS else None
            r["sents"].append(x if x is None else dict(score=x, tail=tail(x, s.sent_pts or s.doc_pts)))
        s.last = key, r
        return r

