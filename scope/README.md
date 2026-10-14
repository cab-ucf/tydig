# Perplexiscope

How a language model reads a text: each word's surprise, how flat the model's guesses were
before it, each sentence's perplexity, and how AI-like each sentence and the whole text read
(by [MELD](https://huggingface.co/anon-review-meld-2026/meld)). A page and a websocket;
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
    `task`, `sents` (`{score, tail}` or `null`); bare where no detector runs
  - `error`: `message`
- `just calib human/*.txt` sets MELD's thresholds for sentences from human writing (into
  `perplexiscope/calib/`; in the container, mount it at `/app/perplexiscope/calib/`).
- `pip install .` gives the `perplexiscope` command and `perplexiscope.Engine`, `.Detector`.

By Chase Brown, GPL-3.0-or-later (LICENSE). MELD is MIT.
