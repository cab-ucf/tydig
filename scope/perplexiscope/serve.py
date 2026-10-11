"""python -m perplexiscope.serve [--model runs/model | gpt2] [--watch demo/lecture.pdf] [--port 8000]"""
import argparse, asyncio, json, threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from watchfiles import awatch
from .data import read
from .engine import Engine

a = argparse.ArgumentParser()
for k, v in dict(model="runs/model", watch="", host="127.0.0.1", port=8000).items(): a.add_argument(f"--{k}", type=type(v), default=v)
a = a.parse_args()
E, lock, clients, doc = Engine(a.model), threading.Lock(), set(), {"text": read(a.watch) if a.watch else ""}


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


def heat(r):
    with lock: return E.heat(r["text"])


def tree(r, then):  # another client may have scored a different text or caret in between
    with lock:
        E.doc and E.doc["text"] == r["text"] or E.heat(r["text"])
        return {**E.tree(r["cursor"], int(r["k"]), int(r["depth"])), **then(r["m"], float(r["a"]), float(r["T"]))}


@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept(); clients.add(ws); box, wake = [None], asyncio.Event()
    await say(ws, type="hello", model=E.name, watching=a.watch or None)
    if doc["text"]: await say(ws, type="doc", text=doc["text"])

    async def work():  # newest request wins; heat is sent before the (slower) tree
        while True:
            await wake.wait(); wake.clear(); r, box[0] = box[0], None
            h = await asyncio.to_thread(heat, r)
            await say(ws, type="heat", seq=r["seq"], **h)
            if box[0] is None and r.get("cursor") is not None:
                t = await asyncio.to_thread(tree, r, lambda *x: {"sampler": E.overlay(*x)})
                if box[0] is None: await say(ws, type="tree", seq=r["seq"], **t)

    w = asyncio.create_task(work())
    async def sample(r): await say(ws, type="sample", seq=r["seq"], **await asyncio.to_thread(tree, r, E.sample))

    try:
        while True:
            r = json.loads(await ws.receive_text())
            if r.get("type") == "sample": asyncio.create_task(sample(r))
            else: box[0] = r; wake.set()
    except WebSocketDisconnect: pass
    finally: w.cancel(); clients.discard(ws)


if __name__ == "__main__":
    import uvicorn
    print(f"http://{a.host}:{a.port}  model {a.model}" + (f"  watching {a.watch}" if a.watch else ""))
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
