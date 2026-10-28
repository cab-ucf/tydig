"""AI-isms: the words and turns of phrase AI text uses far more than human writing, learned
from text rather than listed by hand. A feature is a run of one to three words, or a template
of three to six tokens: the function words and punctuation around masked content words (text
distortion [stamatatos2017]), so "not merely a * *, but a *" matches any filler. Its weight
is log2 of how much more often AI documents than human ones hold it [paech2026antislop]; or,
in scientific prose, how much more often in 2026 than in 2017, for words and turns that
existed before and spread across fields [kobak2025delving]. A span's is its strongest feature's.

    Isms()(text) -> [{s, e, x, f}]: characters, log2 of the excess, the feature
    python -m perplexiscope.isms   fits isms.json from DetectRL-X and arXiv (see main)"""
import collections, json, math, re
from pathlib import Path

PROFILE = Path(__file__).with_suffix(".json")
TOK = re.compile(r"\w+(?:['-]\w+)*|[^\w\s]")
NORM = str.maketrans("“”‘’", "\"\"''")
SHOW = 4  # 16 times as common: a mark in about 190 words of human writing, in tests


def toks(t): return [(m.group().lower(), m.start(), m.end()) for m in TOK.finditer(t.translate(NORM))]


def grams(ws, fw):  # (start, length, feature) for every feature in the words
    m = [w if w in fw else "*" for w in ws]
    for n in range(1, 7):
        for i in range(len(ws) - n + 1):
            g, k = ws[i:i + n], m[i:i + n]
            if n <= 3 and "*" in k: yield i, n, " ".join(g)
            if n >= 3 and k[0] != "*" != k[-1] and 0 < k.count("*") < n - 1: yield i, n, " ".join(k)


def df(texts, fw):  # in how many documents each feature is
    c = collections.Counter()
    for t in texts: c.update({f for *_, f in grams([w for w, *_ in toks(t)], fw)})
    return c


def excess(a, na, h, nh): return math.log2((a + 1) / (na + 2) * (nh + 2) / (h + 1))


JUNK = re.compile(r"word count|[\[\]#$\\{}`^=~]|\*\*")


def fit(ai, human, old=(), new=(), k=150, least=15):  # old, new: [(field, text)]
    fw = {w for w, _ in collections.Counter(w for t in human for w, *_ in toks(t)).most_common(k)}
    fw |= {w for t in human for w, *_ in toks(t) if re.match(r"\W", w)}  # and punctuation
    a, h, na, nh = df(ai, fw), df(human, fw), len(ai), len(human)
    x = {f: v for f, n in a.items() if n >= least and not JUNK.search(f)
         and (v := excess(n, na, h[f], nh)) >= SHOW}
    o, n, where = df((t for _, t in old), fw), collections.Counter(), collections.defaultdict(set)
    for c, t in new:
        fs = {f for *_, f in grams([w for w, *_ in toks(t)], fw)}
        n.update(fs); [where[f].add(c) for f in fs]
    for f, m in n.items():  # risen across fields, not new topics, and no less AI's than human
        if (m >= 12 and len(where[f]) >= 4 and o[f] >= 3 and not JUNK.search(f) and
                (v := excess(m, len(new), o[f], len(old))) >= SHOW and
                (a[f] + h[f] < 5 or excess(a[f], na, h[f], nh) >= 1)):
            x[f] = max(v, x.get(f, 0))
    return dict(fw=sorted(fw), x={f: round(v, 1) for f, v in sorted(x.items())})


class Isms:
    def __init__(s, path=PROFILE):
        p = json.loads(Path(path).read_text()); s.fw, s.x = set(p["fw"]), p["x"]

    def __call__(s, text):
        T = toks(text); best = [(0., "")] * len(T)
        for i, n, f in grams([w for w, *_ in T], s.fw):
            if v := s.x.get(f):
                for j in range(i, i + n): best[j] = max(best[j], (v, f))
        out = []  # marked words next to each other are one span, as strong as its strongest
        for (_, a, b), (v, f) in zip(T, best):
            if v < SHOW: continue
            if out and not text[out[-1]["e"]:a].strip(): z = out[-1]; z["e"] = b
            else: z = dict(s=a, e=b, x=0); out.append(z)
            if v > z["x"]: z.update(x=v, f=f)
        return out


def main():  # the shipped profile: DetectRL-X's English (MIT), arXiv's abstracts (CC0)
    import html, sys, time, urllib.request
    get = lambda u: urllib.request.urlopen(u, timeout=300).read()
    D = [x for s in ("general", "polishing") for x in json.loads(get(
        f"https://huggingface.co/datasets/WUJUNCHAO/DetectRL-X/resolve/main/Binary/binary_{s}_open.json"))
         if x["lang"] == "english" and x["split"] == "train"]
    ab = {}
    for y, r in (("old", "201701010000+TO+201712312359"), ("new", "202601010000+TO+202609302359")):
        for c in sys.argv[1:] or ("q-bio.NC q-bio.QM q-bio.PE physics.bio-ph cond-mat.soft cond-mat.mtrl-sci "
                                  "astro-ph.GA physics.flu-dyn physics.soc-ph eess.SP stat.ME econ.GN cs.HC "
                                  "cs.CY math.OC physics.optics").split():
            q = get(f"https://export.arxiv.org/api/query?search_query=cat:{c}+AND+submittedDate:"
                    f"%5B{r}%5D&max_results=800&sortBy=submittedDate").decode()
            ab.setdefault(y, []).extend((c, " ".join(html.unescape(a).split()))
                                        for a in re.findall(r"<summary>(.*?)</summary>", q, re.S))
            time.sleep(3.5)  # arXiv's rate
    p = fit([x["llm_generated_text"] for x in D], [x["human_written_text"] for x in D], ab["old"], ab["new"])
    PROFILE.write_text(json.dumps(p, separators=(",", ":")))
    print(f"{PROFILE}: {len(p['x'])} features, from {len(D)} pairs and {len(ab['new'])} + {len(ab['old'])} abstracts")


if __name__ == "__main__":
    main()
