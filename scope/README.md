# Perplexiscope

How a language model reads a text: each word's surprise, how flat the model's guesses were
before it, each sentence's perplexity, and how AI-like each sentence and the whole text read
(by [MELD](https://huggingface.co/anon-review-meld-2026/meld)), and its AI-isms. A page and a websocket;
[tydig](https://github.com/cab-ucf/tydig)'s surprise overlay is a client.

- `just` serves it at http://localhost:8000 (needs [uv](https://docs.astral.sh/uv/)).
  `just image` builds the container with its models in it, so it runs with no network.
- Settings, as variables to `just` and build args: `MODEL`, an attention-only base model
  (`Qwen/Qwen3-0.6B-Base`); `DETECTOR`, `meld` or empty for none; for the image, `TORCH`,
  `cpu` or `cu130` (NVIDIA GPU). `just serve --help` lists the server's options.
- `ws://HOST:8000/ws` takes `{seq, text, cursor, k, depth, m, a, T}` (`cursor: null` for no
  completion tree) and answers each `seq`, a newer request cutting the older one short:
  - `hello` on connecting: `model`, `detector` (`null`: none), `watching`
  - `heat`: `words` (`s, e` characters, `bits`, `rank`, `ent`, `toks`), `sents` (`s, e`, `w`
    words, `n` tokens, `bits`), `ppl`, `bpt`, `ntok`
  - `tree` where `cursor` is set; with `type: "sample"`, a `sample` from the caret
  - `ai`: `score`, `tail` (the share of human texts as AI-like), `words`, `calibrated`, `family`,
    `task`, `sents` (`{score, tail}` or `null`), `isms` (`s, e`, `x`: log2 of how many times as
    common in AI text, `f`: the feature); bare where no detector runs
  - `error`: `message`
- `just calib human/*.txt` sets MELD's thresholds for sentences from human writing (into
  `perplexiscope/calib/`; in the container, mount it at `/app/perplexiscope/calib/`). The one
  shipped is from 300 abstracts written before 2019 (200 NIH grants from RePORTER, 100 arXiv).
- AI-isms (`perplexiscope/isms.py`) are learned, not listed: word runs, and templates of
  function words around masked content words ("not merely a * *, but a *"), each weighted by
  how much more often AI text holds it than human text (DetectRL-X, MIT: GPT-4o, Gemini 2.5
  Flash, DeepSeek-V3, Qwen-Max) or 2026 arXiv abstracts than 2017's, across fields. Marked
  from 16 times as common; on held-out 2026 models (Claude Opus 5, GPT-4.1, among others) the
  marks alone tell AI text from human at AUROC 0.87, one human word in about 190 marked.
  `just isms` fits `perplexiscope/isms.json` again (about 2 GB to download).
- `pip install .` gives the `perplexiscope` command and `perplexiscope.Engine`, `.Detector`.

By Chase Brown, GPL-3.0-or-later (LICENSE). MELD is MIT.
