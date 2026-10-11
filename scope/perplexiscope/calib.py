"""Fit P(AI | z, tokens) for one model on RAID [dugan2024raid], so the engine can show a probability.

    python -m perplexiscope.calib --model gpt2 [--n 1000]  # n human + n AI passages, unattacked, even over domains"""
import argparse, json, numpy as np
from pathlib import Path
from .engine import Engine, calfile

URL = "https://huggingface.co/datasets/liamdugan/raid/resolve/refs%2Fconvert%2Fparquet/raid/partial-train/{:04d}.parquet"


def raid(n, seed):  # memoized under data/: the query reads ~2 GB once
    import duckdb
    f = Path(f"data/raid-{n}-{seed}.parquet")
    if not f.exists():
        f.parent.mkdir(exist_ok=True)
        duckdb.sql(f"""copy (select generation t, model <> 'human' y from read_parquet({[URL.format(i) for i in range(10)]})
            where attack = 'none' qualify row_number() over (partition by model = 'human', domain
            order by hash(id || '{seed}')) <= {n} // 8) to '{f}'""")
    return duckdb.sql(f"select * from '{f}'").fetchall()


def fit(X, y, it=30):  # logistic regression by Newton's method, on standardized features
    sd = np.r_[X[:, :-1].std(0), 1.]; X, w = X / sd, np.zeros(X.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-X @ w))
        w += np.linalg.solve(X.T * (p * (1 - p)) @ X + 1e-6 * np.eye(len(w)), X.T @ (y - p))
    return w / sd


def auroc(s, y):  # chance a random AI span scores above a random human one
    r, k = s.argsort().argsort() + 1., y.sum()
    return (r[y].sum() - k * (k + 1) / 2) / (k * (len(y) - k))


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    for k, v in dict(model="runs/model", n=1000, seed=0).items(): a.add_argument(f"--{k}", type=type(v), default=v)
    a = a.parse_args(); e, rows = Engine(a.model), []
    for i, (t, y) in enumerate(raid(a.n, a.seed)):  # every 5th passage, with its sentences, is held out
        h = e.heat(t)
        rows += [(z["z"], z["n"], y, i % 5 == 0, 0) for z in h["sents"] if z["n"] >= 4] + [(h["ai"]["z"], h["ntok"], y, i % 5 == 0, 1)]
    z, n, y, test, whole = map(np.array, zip(*rows)); y = y.astype(bool)
    X = np.c_[z * np.sqrt(n), n, np.ones_like(z)]
    w = fit(X[~test], y[~test]); p = X @ w
    r = dict(w=w.tolist(), model=a.model, data=f"RAID train, attack none, {a.n} human + {a.n} AI passages, seed {a.seed}",
             heldout_auroc={k: auroc(p[test & (whole == j)], y[test & (whole == j)]) for k, j in (("sentence", 0), ("passage", 1))})
    calfile(a.model).parent.mkdir(exist_ok=True); calfile(a.model).write_text(json.dumps(r, indent=1))
    print(json.dumps(r, indent=1))
