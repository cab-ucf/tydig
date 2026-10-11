"""Corpus: harvest a nested tree of PDFs/text, then train a byte-level BPE [sennrich2016bpe, radford2019gpt2].

    python -m perplexiscope.data fetch            # public-domain demo books via pooch
    python -m perplexiscope.data ingest data/raw  # -> data/corpus.txt (memoized per file, deduplicated)
    python -m perplexiscope.data tok              # -> data/tok/"""
import hashlib, json, re, sys, unicodedata
from pathlib import Path

EOT, OUT = "<|endoftext|>", Path("data")
BOOKS = {"literature/shakespeare.txt": 100, "science/biology/origin.txt": 1228, "science/physics/relativity.txt": 5001, "history/federalist.txt": 1404}


def clean(t):
    t = unicodedata.normalize("NFC", t).replace("\r\n", "\n")
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)  # re-join words hyphenated across PDF lines
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t\u00a0]+", " ", t)).strip()


def unwrap(t):  # PDF line wraps are layout, not text: a line well short of the typical width ends a paragraph
    L = [l.strip() for l in t.split("\n")]; w = sorted(map(len, L))[int(len(L) * .8)] if L else 0
    return "".join(l + ("\n\n" if len(l) < .7 * w or l.endswith(":") else " ") for l in L if l)


def read(p):
    p = Path(p)
    try:
        if p.suffix.lower() == ".pdf":
            from pypdf import PdfReader
            return clean(unwrap(clean("\n".join(pg.extract_text() or "" for pg in PdfReader(p).pages))))
        return clean(p.read_text(errors="replace"))
    except Exception as x:
        print(f"skip {p}: {x}", file=sys.stderr); return ""


def fetch(root="data/raw"):
    import pooch
    for rel, n in BOOKS.items():
        (d := Path(root, rel)).parent.mkdir(parents=True, exist_ok=True)
        if not d.exists(): d.write_bytes(Path(pooch.retrieve(f"https://www.gutenberg.org/cache/epub/{n}/pg{n}.txt", None)).read_bytes())


def ingest(root="data/raw"):
    memo_f = OUT / ".memo.json"; memo = json.loads(memo_f.read_text()) if memo_f.exists() else {}
    files = sorted(p for p in Path(root).rglob("*") if p.suffix.lower() in {".pdf", ".txt", ".md", ".typ", ".tex", ".rst"})
    docs, seen, new = [], set(), {}
    for p in files:
        sig = f"{p.stat().st_mtime_ns}:{p.stat().st_size}"
        t = memo[str(p)][1] if memo.get(str(p), [None])[0] == sig else read(p)
        new[str(p)] = [sig, t]
        if len(t) > 200 and (h := hashlib.sha1(t.encode()).digest()) not in seen: seen.add(h); docs.append(t)
    memo_f.write_text(json.dumps(new)); (OUT / "corpus.txt").write_text(EOT.join(docs))
    print(f"{len(docs)} documents from {len(files)} files")


def tok(vocab=16384):
    from tokenizers import Tokenizer, models, pre_tokenizers, decoders, trainers
    from transformers import PreTrainedTokenizerFast
    t = Tokenizer(models.BPE()); t.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False); t.decoder = decoders.ByteLevel()
    t.train([str(OUT / "corpus.txt")], trainers.BpeTrainer(vocab_size=int(vocab), special_tokens=[EOT], initial_alphabet=pre_tokenizers.ByteLevel.alphabet()))
    PreTrainedTokenizerFast(tokenizer_object=t, eos_token=EOT, bos_token=EOT).save_pretrained(OUT / "tok")


if __name__ == "__main__":
    {"fetch": fetch, "ingest": ingest, "tok": tok}[sys.argv[1]](*sys.argv[2:])
