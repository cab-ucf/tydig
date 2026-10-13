"""How AI-like each sentence and the whole text read, from MELD [li2026meld]: an open (MIT) encoder trained on 10M
human and AI texts from 78 generators. It is the strongest open detector on RAID's hidden test set [dugan2024raid],
and its authors measure 99.7% TPR at 1% FPR on GPT-5.4-mini, Gemini-3-Flash, Claude-Haiku-4.5 and Qwen-3.6-Plus,
where likelihood detectors such as Fast-DetectGPT and Binoculars reach 17% and 0.6%.

A score is MELD's top-quarter mean of its token scores. The document's is compared with the thresholds MELD set on
22,190 human documents; a sentence's with human sentences scored by `python -m perplexiscope.bench calib`. Either
way the result is how rare that score is among human writing, never a probability that the text is AI."""
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


def align(a, b):  # for each character of a, the index in b it came from (MELD strips markup and folds look-alikes)
    out = [-1] * len(a)
    for x, y, k in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        out[x:x + k] = range(y, y + k)
    for i in range(len(out)): out[i] = out[i] if out[i] >= 0 else (out[i - 1] if i else 0)
    return out


def tail(x, pts):  # share of human texts scoring at least x, log-interpolated between [score, share] points
    for (a, p), (b, q) in zip(pts, pts[1:]):
        if x < b: return p if x <= a else p * (q / p) ** ((x - a) / (b - a))
    return pts[-1][1]


class Detector:
    def __init__(s, path=None, device=None):
        path = path or snapshot_download(REPO, revision=REV)
        s.M = meld(path); s.sc = s.M.Scorer(path, device)
        cut = s.sc.cfg["score_offsets"]["overall"]
        s.doc_pts = [[cut[f"fpr_{f}"], f] for f in (.1, .05, .01)]
        s.sent_pts = json.loads(CAL.read_text())["points"] if CAL.exists() else None
        s.last = None

    def tq(s, v): return float(s.M.top_quantile_mean(v, s.sc.rho))

    @torch.no_grad()
    def __call__(s, text, spans=()):  # spans: (start, end) characters of each sentence in text
        if s.last and s.last[0] == (text, tuple(map(tuple, spans))): return s.last[1]
        canon, sc = s.M.canonicalize(text), s.sc
        e = sc.tok(canon, add_special_tokens=False, return_offsets_mapping=True)
        ids, off = e.input_ids[:sc.cap], e.offset_mapping[:sc.cap]
        if not ids: return None
        c, f, o = [], [], []
        for i in range(0, len(ids), sc.window):  # MELD's contract: disjoint windows, fresh CLS/SEP, fp32
            x = torch.tensor([[sc.cls_id, *ids[i:i + sc.window], sc.sep_id]], device=sc.device)
            for acc, t in zip((f, c, o), sc.model.token_scores(x, torch.ones_like(x))): acc.append(t[0, 1:-1].cpu())
        c, f, o = torch.cat(c), torch.cat(f), torch.cat(o)
        pos = align(canon, text); at = [pos[a] for a, _ in off]
        score = s.tq(c)
        r = dict(score=score, tail=tail(score, s.doc_pts), words=len(canon.split()), calibrated=s.sent_pts is not None,
                 family=sc.cfg["families"][int(s.M.top_quantile_mean(f, sc.rho).argmax())],
                 task=sc.cfg["ops"][int(s.M.top_quantile_mean(o, sc.rho).argmax())], sents=[])
        for a, b in spans:
            lo, hi = bisect_left(at, a), bisect_left(at, b)
            x = s.tq(c[lo:hi]) if hi - lo >= MIN_TOKENS else None
            r["sents"].append(None if x is None else dict(score=x, tail=tail(x, s.sent_pts or s.doc_pts)))
        s.last = ((text, tuple(map(tuple, spans))), r)
        return r
