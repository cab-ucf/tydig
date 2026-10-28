"""The page at /, the websocket at /ws, the state at /healthz.

    python -m perplexiscope.serve [--model Qwen/Qwen3-0.6B-Base] [--detector meld|PATH|""]
        [--watch FILE] [--host 127.0.0.1] [--port 8000] [--dtype float32] [--max-chars 100000]"""
import argparse, asyncio, json, logging, re, sys, threading, unicodedata
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
import torch, uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from watchfiles import awatch
from .detect import Detector
from .engine import Engine
from .isms import Isms

log = logging.getLogger("uvicorn.error")


def clean(t):
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", unicodedata.normalize("NFC", t).replace("\r\n", "\n"))
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t\u00a0]+", " ", t)).strip()


def read(p):  # a watched file's text; a PDF's lines unwrapped, a short line ending a paragraph
    try:
        if p.suffix.lower() != ".pdf": return clean(p.read_text(errors="replace"))
        from pypdf import PdfReader
        L = [l.strip() for l in clean("\n".join(g.extract_text() or "" for g in PdfReader(p).pages))
             .split("\n")]
        w = sorted(map(len, L))[int(len(L) * .8)] if L else 0
        return clean("".join(l + ("\n\n" if len(l) < .7 * w or l.endswith(":") else " ")
                             for l in L if l))
    except Exception as x:
        log.warning(f"cannot read {p}: {x}"); return ""


def app(model, detector, watch, dtype, max_chars, **_):
    E = Engine(model, dtype=dtype and getattr(torch, dtype))
    D = detector and Detector(None if detector == "meld" else detector)  # a path: a local MELD
    I = Isms()
    lock, dlock, clients = threading.Lock(), threading.Lock(), set()
    watch = watch and Path(watch).resolve()
    doc = read(watch) if watch else ""

    async def say(ws, **m): await ws.send_text(json.dumps(m))

    async def watching():  # typst rewrites the PDF; mirror every rebuild to every client
        nonlocal doc
        async for _ in awatch(watch.parent, recursive=False, debounce=150,
                              watch_filter=lambda _, p: Path(p) == watch):
            for _ in range(5):  # the file may be caught half written
                if t := await asyncio.to_thread(read, watch): break
                await asyncio.sleep(.2)
            if t and t != doc:
                doc = t
                for ws in list(clients): await say(ws, type="doc", text=t)

    @asynccontextmanager
    async def life(_):
        task = watch and asyncio.create_task(watching()); yield
        task and task.cancel()

    def heat(r):
        with lock: return E.heat(r["text"])

    def detect(r, sents):  # MELD's reading, and the AI-isms in the text
        with dlock: a = D(r["text"], [(z["s"], z["e"]) for z in sents])
        return a and {**a, "isms": I(r["text"])}

    def tree(r, then):  # another client may have scored a different text in between
        with lock:
            E.doc and E.doc["text"] == r["text"] or E.heat(r["text"])
            return {**E.tree(r["cursor"], int(r["k"]), int(r["depth"])),
                    **then(r["m"], float(r["a"]), float(r["T"]))}

    a = FastAPI(lifespan=life)
    a.get("/")(lambda: FileResponse(Path(__file__).parent / "web/index.html"))
    a.get("/healthz")(lambda: dict(model=model, detector=detector or None, device=E.dev,
                                   sentences_calibrated=bool(D and D.sent_pts)))

    @a.websocket("/ws")
    async def ws(ws: WebSocket):
        # any site's page may score text (tydig's overlay does); the watched file
        # is read only by pages of this machine, never a site's, nor one rebound here
        o = ws.headers.get("origin")
        own = not o or urlsplit(o).hostname in ("localhost", "127.0.0.1", "::1")
        await ws.accept(); own and clients.add(ws); box, wake = [None], asyncio.Event()
        await say(ws, type="hello", model=model, detector=detector or None,
                  watching=own and watch and str(watch) or None)
        if own and doc: await say(ws, type="doc", text=doc)

        async def guard(r, job):  # a bad or oversized request is answered, never a dead socket
            try:
                if len(r["text"]) > max_chars:
                    raise ValueError(f"Text is over {max_chars:,} characters; shorten it to score it.")
                await job(r)
            except WebSocketDisconnect: raise
            except Exception as x:
                log.exception("request failed"); await say(ws, type="error", message=str(x))

        async def score(r):  # heat, tree, then the slow detector, each while nothing newer waits
            h = await asyncio.to_thread(heat, r)
            await say(ws, type="heat", seq=r["seq"], **h)
            if box[0] is None and r.get("cursor") is not None:
                t = await asyncio.to_thread(tree, r, lambda *x: {"sampler": E.overlay(*x)})
                if box[0] is None: await say(ws, type="tree", seq=r["seq"], **t)
            if box[0] is None and (not D or h["sents"]):  # bare where no detector runs
                ai = D and await asyncio.to_thread(detect, r, h["sents"])
                await say(ws, type="ai", seq=r["seq"], **(ai or {}))

        async def work():  # the newest request wins
            while True:
                await wake.wait(); wake.clear(); r, box[0] = box[0], None
                await guard(r, score)

        async def sample(r):
            await say(ws, type="sample", seq=r["seq"], **await asyncio.to_thread(tree, r, E.sample))

        w, jobs = asyncio.create_task(work()), set()
        try:
            while True:
                try: r = json.loads(await ws.receive_text()); r["text"]
                except (ValueError, TypeError, KeyError):
                    await say(ws, type="error", message="Malformed request."); continue
                if r.get("type") == "sample":  # held, or the loop may drop it unfinished
                    j = asyncio.create_task(guard(r, sample)); jobs.add(j); j.add_done_callback(jobs.discard)
                else: box[0] = r; wake.set()
        except WebSocketDisconnect: pass
        finally: w.cancel(); clients.discard(ws)
    return a


def main():
    p = argparse.ArgumentParser(prog="perplexiscope", description=__doc__.split("\n")[0])
    for k, v in dict(model="Qwen/Qwen3-0.6B-Base", detector="meld", watch="", host="127.0.0.1",
                     port=8000, dtype="", max_chars=100_000).items():
        p.add_argument(f"--{k.replace('_', '-')}", type=type(v), default=v)
    a = p.parse_args()
    print(f"http://{a.host}:{a.port}  model {a.model}  detector {a.detector or 'off'}"
          + (f"  watching {a.watch}" if a.watch else ""), file=sys.stderr)
    uvicorn.run(app(**vars(a)), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
