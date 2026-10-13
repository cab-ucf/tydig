"""python -m perplexiscope.serve [--model Qwen/Qwen3-0.6B-Base] [--detector meld | ""] [--watch demo/lecture.pdf]
                                [--host 127.0.0.1] [--port 8000] [--dtype float32] [--max-chars 100000]"""
import argparse, asyncio, json, logging, threading, torch
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from watchfiles import awatch
from .data import read
from .detect import Detector
from .engine import Engine

a = argparse.ArgumentParser()
for k, v in dict(model="Qwen/Qwen3-0.6B-Base", detector="meld", watch="", host="127.0.0.1", port=8000, dtype="",
                 max_chars=100_000).items(): a.add_argument(f"--{k.replace('_', '-')}", type=type(v), default=v)
a = a.parse_args()
E = Engine(a.model, dtype=a.dtype and getattr(torch, a.dtype))
D = a.detector and Detector(None if a.detector == "meld" else a.detector)  # a path serves a local copy of MELD
lock, dlock, clients, doc, log = threading.Lock(), threading.Lock(), set(), {"text": read(a.watch) if a.watch else ""}, logging.getLogger("uvicorn.error")


async def say(ws, **m): await ws.send_text(json.dumps(m))


async def watch():  # typst rewrites the PDF; mirror every rebuild to every client
    async for _ in awatch(Path(a.watch).parent, debounce=150, watch_filter=lambda _, p: Path(p).name == Path(a.watch).name):
        for _ in range(5):
            if (t := await asyncio.to_thread(read, a.watch)) or await asyncio.sleep(.2): break
        if t and t != doc["text"]:
            doc["text"] = t
            for ws in list(clients): await say(ws, type="doc", text=t)


@asynccontextmanager
async def life(_):
    task = a.watch and asyncio.create_task(watch()); yield
    task and task.cancel()


app = FastAPI(lifespan=life)
app.get("/")(lambda: FileResponse(Path(__file__).parent / "web/index.html"))
app.get("/healthz")(lambda: {"model": a.model, "detector": a.detector or None, "device": E.dev,
                              "sentences_calibrated": bool(D and D.sent_pts)})


def heat(r):
    with lock: return E.heat(r["text"])


def detect(r, sents):
    with dlock: return D(r["text"], [(z["s"], z["e"]) for z in sents])


def tree(r, then):  # another client may have scored a different text or caret in between
    with lock:
        E.doc and E.doc["text"] == r["text"] or E.heat(r["text"])
        return {**E.tree(r["cursor"], int(r["k"]), int(r["depth"])), **then(r["m"], float(r["a"]), float(r["T"]))}


@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept(); clients.add(ws); box, wake = [None], asyncio.Event()
    await say(ws, type="hello", model=E.name, detector=a.detector or None, watching=a.watch or None)
    if doc["text"]: await say(ws, type="doc", text=doc["text"])

    async def guard(r, job):  # a bad or oversized request gets an error back, never a dead socket
        try:
            if len(r["text"]) > a.max_chars: raise ValueError(f"Text is over {a.max_chars:,} characters; shorten it to score it.")
            await job(r)
        except WebSocketDisconnect: raise
        except Exception as x: log.exception("request failed"); await say(ws, type="error", message=str(x))

    async def score(r):  # heat, then the tree, then the (slowest) detector, each only while no newer request waits
        h = await asyncio.to_thread(heat, r)
        await say(ws, type="heat", seq=r["seq"], **h)
        if box[0] is None and r.get("cursor") is not None:
            t = await asyncio.to_thread(tree, r, lambda *x: {"sampler": E.overlay(*x)})
            if box[0] is None: await say(ws, type="tree", seq=r["seq"], **t)
        if box[0] is None and D and h["sents"]:
            await say(ws, type="ai", seq=r["seq"], **(await asyncio.to_thread(detect, r, h["sents"]) or {}))

    async def work():  # newest request wins
        while True:
            await wake.wait(); wake.clear(); r, box[0] = box[0], None
            await guard(r, score)

    w = asyncio.create_task(work())
    async def sample(r): await say(ws, type="sample", seq=r["seq"], **await asyncio.to_thread(tree, r, E.sample))

    try:
        while True:
            try: r = json.loads(await ws.receive_text()); r["text"]
            except (ValueError, TypeError, KeyError): await say(ws, type="error", message="Malformed request."); continue
            if r.get("type") == "sample": asyncio.create_task(guard(r, sample))
            else: box[0] = r; wake.set()
    except WebSocketDisconnect: pass
    finally: w.cancel(); clients.discard(ws)


if __name__ == "__main__":
    import uvicorn
    print(f"http://{a.host}:{a.port}  model {a.model}  detector {a.detector or 'off'}" + (f"  watching {a.watch}" if a.watch else ""))
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
