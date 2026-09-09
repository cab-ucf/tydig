#!/usr/bin/env python3
"""The experiment's analysis. Reads data/, writes build/results.json and a
figure. Every number, direction word, and conclusion in the paper is derived
from this file's output -- the manuscript never contains a typed-in result.

Stdlib-only so it runs in any sandbox; upgrades itself to matplotlib for the
figure when available. Swap in pandas/scipy/julia/R freely: the contract is
only "write build/results.json".
"""
import csv, json, math, statistics, sys, time
from pathlib import Path

DATA = Path("data/experiment.csv")
OUT = Path("build/results.json")
FIG = Path("figures/cooling.svg")

rows = [(float(r["t_min"]), float(r["T_sample_C"]), float(r["T_ambient_C"]))
        for r in csv.DictReader(DATA.open())]
t = [r[0] for r in rows]
T = [r[1] for r in rows]
amb = statistics.fmean(r[2] for r in rows)

# Endpoints: mean of the first/last three readings.
T1 = statistics.fmean(T[:3])
T2 = statistics.fmean(T[-3:])
delta = T2 - T1

# Ordinary least squares T vs t (deg C / min).
n = len(rows)
tm, Tm = statistics.fmean(t), statistics.fmean(T)
sxx = sum((x - tm) ** 2 for x in t)
slope = sum((x - tm) * (y - Tm) for x, y in zip(t, T)) / sxx
resid = [y - (Tm + slope * (x - tm)) for x, y in zip(t, T)]
noise = statistics.stdev(resid)

# Newton's law: ln|T - T_amb| vs t is linear with slope -1/tau.
pts = [(x, math.log(abs(y - amb))) for x, y in zip(t, T) if abs(y - amb) > 0.75]
k = tau = r2 = None
if len(pts) >= 3:
    lx, ly = [p[0] for p in pts], [p[1] for p in pts]
    lxm, lym = statistics.fmean(lx), statistics.fmean(ly)
    b = sum((x - lxm) * (y - lym) for x, y in zip(lx, ly)) / sum((x - lxm) ** 2 for x in lx)
    a = lym - b * lxm
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(lx, ly))
    ss_tot = sum((y - lym) ** 2 for y in ly)
    r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
    if b < 0:
        k = -b
        tau = 1 / k

# Pre-registered decision rule (declared before data collection): the sample
# "changed temperature" iff |T2 - T1| exceeds 3x the residual noise.
if abs(delta) <= 3 * noise:
    direction = "constant"
elif delta < 0:
    direction = "cooling"
else:
    direction = "heating"

t_within_1c = tau * math.log(abs(T1 - amb) / 1.0) if tau and abs(T1 - amb) > 1 else None

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps({
    "generated_utc": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime()),
    "n": n, "t_span_min": t[-1] - t[0],
    "T1": round(T1, 2), "T2": round(T2, 2), "delta": round(delta, 2),
    "T_ambient": round(amb, 2),
    "slope_c_per_min": round(slope, 3), "noise_c": round(noise, 3),
    "direction": direction,
    "conclusive": direction != "constant",
    "newton": None if k is None else {
        "k_per_min": round(k, 4), "tau_min": round(tau, 2), "r2": round(r2, 4),
        "t_within_1c_min": None if t_within_1c is None else round(t_within_1c, 1),
    },
}, indent=1) + "\n")

# ---- figure: matplotlib if present, hand-rolled SVG otherwise ----
FIG.parent.mkdir(exist_ok=True)
try:
    import matplotlib
    matplotlib.use("Agg")
    matplotlib.rcParams["svg.fonttype"] = "path"
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.4, 3.4))
    ax.plot(t, T, "o", ms=4, color="#16191d", label="sample")
    if tau:
        fit = [amb + (T1 - amb) * math.exp(-x / tau) for x in t]
        ax.plot(t, fit, "-", color="#239dad", label=f"Newton fit, tau = {tau:.1f} min")
    ax.axhline(amb, ls="--", lw=1, color="#888", label=f"ambient {amb:.1f} degC")
    ax.set_xlabel("time (min)"); ax.set_ylabel("temperature (degC)")
    ax.legend(frameon=False); fig.tight_layout(); fig.savefig(FIG)
except ImportError:
    W, H, P = 520, 330, 42
    xs, ys = t, T
    sx = lambda x: P + (x - min(xs)) / (max(xs) - min(xs)) * (W - 2 * P)
    sy = lambda y: H - P - (y - min(ys)) / (max(ys) - min(ys)) * (H - 2 * P)
    pl = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in zip(xs, ys))
    FIG.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">'
        f'<rect width="{W}" height="{H}" fill="white"/>'
        f'<polyline points="{pl}" fill="none" stroke="#239dad" stroke-width="2"/>'
        + "".join(f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="3" fill="#16191d"/>'
                  for x, y in zip(xs, ys))
        + f'<line x1="{P}" y1="{H-P}" x2="{W-P}" y2="{H-P}" stroke="#888"/>'
        f'<line x1="{P}" y1="{P}" x2="{P}" y2="{H-P}" stroke="#888"/></svg>')

print(f"analysis: n={n}, direction={direction}, wrote {OUT} and {FIG}", file=sys.stderr)
