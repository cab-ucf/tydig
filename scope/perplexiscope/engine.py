"""Heat and completion tree for one document, from any byte-level causal LM.

A word is the tokens from one whitespace-led token up to the next. Its share of
log p(doc) [shannon1948] is conditioned on the word boundary before it and closed by
the boundary after it, so heatmap and tree report one number per word and sibling
words form a proper distribution. Long documents are scored in half-overlapping
windows; the tree reuses the window's KV cache and grows every branch at once with
tree attention [miao2024specinfer]. Rank and entropy views follow GLTR [gehrmann2019gltr].
A sentence [sadvilkar2020pysbd] is whole words, so its bits are its words' bits and the
boundaries inside it cancel [pimentel2024word]."""
import math, pysbd, torch
from bisect import bisect
from transformers import AutoModelForCausalLM, AutoTokenizer, DynamicCache

NEG, LN2 = float("-inf"), math.log(2)


def sub(cache, n):  # zero-copy prefix view of a KV cache; appends never touch the original
    c = DynamicCache()
    for i, l in enumerate(cache.layers): c.update(l.keys[:, :, :n], l.values[:, :, :n], i)
    return c


def ent(lp): return -(lp.exp() * lp.clamp_min(-1e4)).sum(-1) / LN2


class Engine:
    def __init__(s, name, device=None, ctx=1024, dtype=None):
        s.dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = dtype or (torch.bfloat16 if s.dev == "cuda" else torch.float32)  # bf16 rounds logits; pass float32 for exact bits
        load = lambda n: AutoModelForCausalLM.from_pretrained(n, attn_implementation="sdpa", dtype=dtype).to(s.dev).eval()
        s.tk = AutoTokenizer.from_pretrained(name); s.tk.model_max_length = 1 << 30  # we window long texts ourselves
        s.m = load(name)  # edits and the tree cut and branch the KV cache; recurrent state cannot be
        bad = set(getattr(s.m.config.get_text_config(), "layer_types", None) or []) - {"full_attention"}
        if bad: raise ValueError(f"{name} has {', '.join(sorted(bad))} layers; Perplexiscope needs attention-only models")
        c, s.name = s.m.config, name
        s.T = getattr(c, "ps_temperature", 1.0)  # post-hoc calibration [guo2017calibration]
        s.C = min(getattr(c, "n_positions", 0) or c.max_position_embeddings, ctx); s.S = s.C // 2
        s.bos, V = s.tk.eos_token_id, s.m.get_output_embeddings().weight.shape[0]
        s.B = torch.zeros(V, dtype=torch.bool, device=s.dev)  # tokens that open a new word (or end the text)
        s.B[:len(s.tk)] = torch.tensor([s.tk.decode([i])[:1].isspace() for i in range(len(s.tk))]); s.B[s.bos] = True
        s.win, s.doc, s.last, s.seg = {}, None, None, pysbd.Segmenter(char_span=True)

    @torch.no_grad()
    def fwd(s, ids, cache=None, pos=None, mask=None):
        o = s.m(torch.tensor([ids], device=s.dev), past_key_values=cache, use_cache=True, attention_mask=mask,
                position_ids=None if pos is None else torch.tensor([pos], device=s.dev))
        return (o.logits[0].float() / s.T).log_softmax(-1), o.past_key_values

    def lB(s, lp): return lp.masked_fill(~s.B, NEG).logsumexp(-1)

    def window(s, st, ids):  # row r predicts window token r+1: (logp, rank, entropy, log P(boundary)); re-runs only the edited suffix
        old = s.win.get(st)
        l = next((i for i, (a, b) in enumerate(zip(old[0], ids)) if a != b), min(len(old[0]), len(ids))) if old else 0
        if old and l == len(ids) == len(old[0]): return old
        l = max(l, 1)
        lp, cache = s.fwd(ids[l - 1:], sub(old[1], l - 1) if old else None)
        g = lp[:-1].gather(1, torch.tensor(ids[l:], dtype=torch.long, device=s.dev)[:, None])[:, 0]
        z = g.new_zeros(1)
        new = [torch.cat([g, z]), torch.cat([(lp[:-1] > g[:, None]).sum(1) + 1., z]), ent(lp), s.lB(lp)]
        s.win[st] = w = (ids, cache, [torch.cat([o[:l - 1], x]) for o, x in zip(old[2], new)] if old else new)
        return w

    def k(s, t): return 0 if t < s.C else (t - s.S) // s.S  # the window that scores token t

    def heat(s, text):
        e = s.tk(text, return_offsets_mapping=True, add_special_tokens=False)
        ids, off, n = [s.bos] + e.input_ids, [(0, 0)] + [tuple(o) for o in e.offset_mapping], len(e.input_ids) + 1
        K = s.k(n) + 1
        s.win = {st: w for st, w in s.win.items() if st < K * s.S}
        W = [s.window(k * s.S, ids[k * s.S:k * s.S + s.C]) for k in range(K)]
        seg = [(k * s.S, 1 if k == 0 else (k + 1) * s.S, min(k * s.S + s.C, n + 1)) for k in range(K)]
        lp, rk, en, lb = [torch.cat([W[k][2][i][lo - st - 1:hi - st - 1] for k, (st, lo, hi) in enumerate(seg)]).tolist() for i in range(4)]
        groups = []  # [char start, t0, t1, char end]: whitespace-only tokens join the following word
        for t in range(1, n):
            a, b = off[t]
            if not groups or (text[a:b][:1].isspace() and text[groups[-1][0]:off[t - 1][1]].strip()): groups.append([a, t, 0, 0])
            groups[-1][2:] = t + 1, b
        words = []
        for a, t0, t1, b in groups:
            c = a + len(text[a:b]) - len(text[a:b].lstrip())
            if c == b: continue
            share = sum(lp[t0 - 1:t1 - 1]) - (lb[t0 - 1] if t0 > 1 else 0) + lb[t1 - 1]
            words.append(dict(s=c, e=b, t0=t0, t1=t1, bits=-share / LN2, rank=int(rk[t0 - 1]), ent=en[t0 - 1],
                              toks=[[text[off[t][0]:off[t][1]], -lp[t - 1] / LN2] for t in range(t0, t1)]))
        at = [w["s"] for w in words]  # each sentence starts at the word holding its first character
        cut = sorted({0, *(max(0, bisect(at, z.start) - 1) for z in s.seg.segment(text))}) if words else []
        sents = [dict(s=words[i]["s"], e=words[j - 1]["e"], w=j - i, n=words[j - 1]["t1"] - words[i]["t0"],
                      bits=sum(w["bits"] for w in words[i:j])) for i, j in zip(cut, cut[1:] + [len(words)])]
        s.doc = dict(ids=ids, words=words, n=n, text=text)
        nll = -sum(lp[:n - 1]) / max(1, n - 1)
        return dict(words=[{k: w[k] for k in ("s", "e", "bits", "rank", "ent", "toks")} for w in words],
                    sents=sents, ppl=math.exp(nll), bpt=nll / LN2, ntok=n - 1)

    @torch.no_grad()
    def tree(s, cursor, k=3, depth=4, budget=40, min_cum=1e-4):
        d = s.doc; ids = d["ids"]
        i = next((i for i, w in enumerate(d["words"]) if w["e"] > cursor), len(d["words"]))  # the word at or after the caret
        act = d["words"][i:i + depth]
        j = act[0]["t0"] if act else d["n"]
        key = (d["text"], j, k, depth, budget)
        if s.last and s.last["key"] == key: return s.last["view"]
        st = s.k(j) * s.S; base = j - st
        D0, cache = s.fwd([ids[j - 1]], sub(s.window(st, ids[st:st + s.C])[1], base - 1), [base - 1])
        rc = sub(cache, base)  # the caret's context, kept clean for sampling
        par, pos, out = [], [], []

        def feed(items):  # [(parent slot, token)]: one forward, each token sees the context and its own ancestors
            nonlocal cache
            k0 = len(par)
            for p, t in items: par.append(p); pos.append(pos[p] + 1 if p >= 0 else base)
            m = torch.full((len(items), base + len(par)), NEG, device=s.dev); m[:, :base] = 0
            for q in range(len(items)):
                a = k0 + q
                while a >= 0: m[q, base + a] = 0; a = par[a]
            lp, cache = s.fwd([t for _, t in items], cache, pos[k0:], m[None, None].to(s.m.dtype))
            out.extend(lp)
            return range(k0, len(par))

        root = dict(id=0, parent=None, toks=[], lp=0., cum=0., rel=0., depth=0, actual=True, slot=-1, D=D0[0])
        nodes, level, floor = [root], [root], math.log(min_cum)
        while level:
            forced, cand = [], []
            for nd in level:
                if nd["depth"] >= depth: continue
                first = nd["id"] == 0 and j == 1  # the document's first word has no boundary before it
                norm, D = 0. if first else s.lB(nd["D"]).item(), nd["D"] if first else nd["D"].masked_fill(~s.B, NEG)
                a = act[nd["depth"]] if nd["actual"] and nd["depth"] < len(act) else None
                if a: forced.append((nd, ids[a["t0"]:a["t1"]], D[ids[a["t0"]]].item() - norm, True))
                top = D.topk(k + 1)
                cand += [(nd, [t], v - norm, False) for v, t in zip(top.values.tolist(), top.indices.tolist())
                         if not (a and t == ids[a["t0"]]) and nd["rel"] + v - norm > floor][:k]
            cand.sort(key=lambda c: -(c[0]["rel"] + c[2]))  # best-first, measured from where the branch leaves the page
            active = [dict(id=0, parent=p, toks=t, lp=v, depth=p["depth"] + 1, actual=f, slot=None, pend=t, pre=[p["D"]])
                      for p, t, v, f in forced + cand[:max(0, budget - len(nodes) - len(forced))]]
            for nd in active: nd["id"] = len(nodes); nodes.append(nd)
            level = []
            while active:  # feed pending pieces; greedily extend each word until ending it is likelier than going on
                items, span = [], []
                for nd in active:
                    prev = nd["slot"] if nd["slot"] is not None else nd["parent"]["slot"]
                    for t in nd["pend"]: items.append((prev, t)); prev = len(par) + len(items) - 1
                    span.append(len(nd["pend"]))
                slots, nxt = list(feed(items)), []
                for nd, L in zip(active, span):
                    ss, slots = slots[:L], slots[L:]
                    if nd["slot"] is None:
                        nd["lp"] += sum(out[ss[q - 1]][nd["toks"][q]].item() for q in range(1, L)); nd["pre"] += [out[x] for x in ss[:-1]]
                    nd["slot"], D = ss[-1], out[ss[-1]]
                    end, (cv, ct) = s.lB(D).item(), D.masked_fill(s.B, NEG).max(0)
                    if nd["actual"] or len(nd["toks"]) >= 4 or (end >= cv.item() and s.tk.decode(nd["toks"]).strip()):
                        nd.update(lp=nd["lp"] + end, D=D); nd.update(cum=nd["parent"]["cum"] + nd["lp"], rel=0. if nd["actual"] else nd["parent"]["rel"] + nd["lp"]); level.append(nd)
                    else:
                        nd["lp"] += cv.item(); nd["toks"] = nd["toks"] + [ct.item()]; nd["pend"] = [ct.item()]; nd["pre"].append(D); nxt.append(nd)
                active = nxt
        dec = lambda t: s.tk.decode(t)
        view = dict(at=act[0]["s"] if act else len(d["text"]), actual=[[a["s"], a["e"]] for a in act], ent=ent(D0[0]).item(),
                    nodes=[dict(id=n["id"], parent=n["parent"] and n["parent"]["id"], word=dec(n["toks"]).strip(),
                                nl="\n" in dec(n["toks"][:1]), p=math.exp(n["lp"]), cum=math.exp(n["cum"]), depth=n["depth"],
                                actual=n["actual"], ids=n["toks"]) for n in nodes])
        s.last = dict(key=key, view=view, nodes=nodes, open0=j == 1, cache=rc, base=base, D0=D0[0])
        return view

    def keep(s, lp, m, a):  # one decoding step: which tokens survive, renormalized (log q)
        p, ok = lp.exp(), torch.zeros_like(s.B)
        if m == "topk": ok = lp >= lp.topk(max(1, int(a))).values[-1]  # [fan2018hierarchical]
        elif m in ("topp", "typical"):  # nucleus [holtzman2020curious]; locally typical set [meister2023typical]
            i = (-lp if m == "topp" else (lp + ent(lp) * LN2).abs()).argsort()
            ok[i[:int((p[i].cumsum(0) < a).sum()) + 1]] = True
        elif m == "minp": ok = p >= a * p.max()  # [nguyen2025minp]
        elif m == "eta": ok = p > min(a, math.sqrt(a) * math.exp(-ent(lp).item() * LN2))  # [hewitt2022truncation]
        elif m == "nsigma": ok = lp >= lp.max() - a * lp.clamp_min(-1e4).std()  # [tang2025topnsigma]
        elif m == "mirostat": ok = -lp / LN2 <= a  # surprise ceiling mu [basu2021mirostat]
        else: ok = ~ok
        if not ok.any(): ok[lp.argmax()] = True  # typical may rightly drop the top token; nothing else may empty the set
        return lp.masked_fill(~ok, NEG).log_softmax(-1)

    def overlay(s, m, a, T):  # each tree word's chance under the sampler, and how many word starts it keeps per branch point
        L, Q, chance, kept = s.last, {}, {}, {}
        def q(D): return Q[id(D)] if id(D) in Q else Q.setdefault(id(D), s.keep((D / T).log_softmax(-1), m, 2 * a if m == "mirostat" else a))
        for n in L["nodes"][1:]:
            first, qs = n["parent"]["id"] == 0 and L["open0"], [q(D) for D in n["pre"] + [n["D"]]]
            v = sum(x[t].item() for x, t in zip(qs, n["toks"])) - (0. if first else s.lB(qs[0]).item()) + s.lB(qs[-1]).item()
            chance[n["id"]] = math.exp(v) if math.isfinite(v) else 0.
            kept.setdefault(n["parent"]["id"], int(((qs[0] > NEG) & (torch.ones_like(s.B) if first else s.B)).sum()))
        return dict(chance=chance, kept=kept)

    @torch.no_grad()
    def sample(s, m, a, T, words=4):  # generate from the caret under the sampler, token by token
        L = s.last; cache, D, pos, mu, n, has, out = sub(L["cache"], L["base"]), L["D0"], L["base"], 2 * a, 0, False, []
        for _ in range(12 * words):
            lp = (D / T).log_softmax(-1); lq = s.keep(lp, m, mu if m == "mirostat" else a)
            t = int(torch.multinomial(lq.exp(), 1)); piece = s.tk.decode([t])
            if piece[:1].isspace() and has: n += 1
            if t == s.bos or n == words: break
            has = bool(piece.strip()) or (has and not piece[:1].isspace())
            if m == "mirostat": mu -= .1 * (-lp[t].item() / LN2 - a)
            out.append(dict(t=piece, p=math.exp(D[t].item()), q=math.exp(lq[t].item())))
            D, cache = s.fwd([t], cache, [pos]); D, pos = D[0], pos + 1
        return dict(tokens=out)
