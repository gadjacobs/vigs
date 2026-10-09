"""Blend of market price and results model, learned from settled matches.

For each market: P(win) = sigmoid(a + b1 * logit(market chance) + b2 * logit(model)).
Trained on settled matches with a pre-kickoff odds snapshot. The model input is
point-in-time: for matches on day D it comes from a model fitted on results
before D. A blend switches on for a market only when there is enough data and
it beats the results model on the most recent 30% of matches, which it did not
train on. Until then the app and `likely` use `guarded`: a constant 70/30 weighting
toward the market price, with a range that spans both views.
"""
from __future__ import annotations

import csv
import glob
import json
import math
import os
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from . import model as md
from .data import fair_probs, settle
from .odds import LIVE_DEVIG

MIN_MATCHES = 2000          # settled matches with odds before any blend can switch on
TEST_SHARE = 0.30
PRIOR = (0.0, 1.0, 0.0)     # shrink toward "trust the market"
RIDGE = 2.0                 # prior strength, in pseudo-observations
REPS = 20
EPS = 1e-6
# Until a blend is proven: 0.7 * logit(market) + 0.3 * logit(model). On the first
# 269 settled matches with odds (4,914 selections) the market price beat the
# results model on log loss in all 10 markets checked; this weighting cut most of
# the gap (pooled 0.4968 vs market 0.4960, model 0.5038).
GUARD = (0.0, 0.7, 0.3)


def logit(p: float) -> float:
    p = min(max(p, EPS), 1 - EPS)
    return math.log(p / (1 - p))


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


def apply(coef: list[float], q: float, p: float) -> float:
    a, b1, b2 = coef
    return sigmoid(a + b1 * logit(q) + b2 * logit(p))


def log_loss(ps: list[float], ys: list[int]) -> float:
    return -sum(math.log(min(max(p, EPS), 1 - EPS)) if y else math.log(min(max(1 - p, EPS), 1 - EPS))
                for p, y in zip(ps, ys)) / len(ys)


def fit_logistic(xs: list[tuple[float, float]], ys: list[int], iters: int = 25) -> list[float]:
    """Newton-Raphson for 3 coefficients with a ridge penalty toward PRIOR."""
    w = list(PRIOR)
    for _ in range(iters):
        g = [RIDGE * (w[k] - PRIOR[k]) for k in range(3)]
        h = [[RIDGE if i == j else 0.0 for j in range(3)] for i in range(3)]
        for (x1, x2), y in zip(xs, ys):
            f = (1.0, x1, x2)
            p = sigmoid(w[0] + w[1] * x1 + w[2] * x2)
            r = p - y
            s = p * (1 - p)
            for i in range(3):
                g[i] += r * f[i]
                for j in range(3):
                    h[i][j] += s * f[i] * f[j]
        step = _solve3(h, g)
        w = [w[k] - step[k] for k in range(3)]
        if max(abs(v) for v in step) < 1e-9:
            break
    return w


def _solve3(a: list[list[float]], b: list[float]) -> list[float]:
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(3):
        piv = max(range(c, 3), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(3):
            if r != c and m[c][c]:
                f = m[r][c] / m[c][c]
                m[r] = [m[r][k] - f * m[c][k] for k in range(4)]
    return [m[i][3] / m[i][i] if m[i][i] else 0.0 for i in range(3)]


# ------------------------------------------------------------- training data --

def snapshots(data_dir: str) -> dict[str, dict]:
    """Last odds snapshot taken before kickoff, per event."""
    out: dict[str, dict] = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "odds", "*.jsonl"))):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                s = json.loads(line)
                if s["captured_at"] > s["kickoff"]:
                    continue
                prev = out.get(s["event_id"])
                if prev is None or s["captured_at"] >= prev["captured_at"]:
                    out[s["event_id"]] = s
    return out


def training_rows(data_dir: str, window_days: float = 30) -> list[dict]:
    """(kickoff, market, q, p, y) for every settled match with pre-kickoff odds.
    p comes from a model fitted on results before the match's UTC day."""
    with open(os.path.join(data_dir, "results.csv"), newline="", encoding="utf-8") as fh:
        results = list(csv.DictReader(fh))
    by_id = {r["event_id"]: r for r in results}
    snaps = snapshots(data_dir)
    joined = [(s, by_id[e]) for e, s in snaps.items() if e in by_id]
    by_day: dict[str, list] = defaultdict(list)
    for s, r in joined:
        by_day[r["kickoff"][:10]].append((s, r))
    rows = []
    for day, items in sorted(by_day.items()):
        start = datetime.fromisoformat(day + "T00:00:00+00:00")
        lo = (start - timedelta(days=window_days)).isoformat().replace("+00:00", "Z")
        hi = start.isoformat().replace("+00:00", "Z")
        base = [r for r in results if lo <= r["kickoff"] < hi]
        if len(base) < 1000:
            continue
        models = md.fit(base)
        for s, r in items:
            p = md.predict(models, s["league"], s["home"], s["away"])
            if p is None:
                continue
            q = fair_probs(s["odds"], LIVE_DEVIG)
            hth = int(r["ht_hg"]) if r.get("ht_hg") not in ("", None) else None
            hta = int(r["ht_ag"]) if r.get("ht_ag") not in ("", None) else None
            for mk, qv in q.items():
                if mk not in p:
                    continue
                y = settle(mk, int(r["hg"]), int(r["ag"]), hth, hta)
                if y is None:
                    continue
                rows.append({"kickoff": r["kickoff"], "event": s["event_id"], "market": mk,
                             "q": qv, "p": p[mk], "y": int(y)})
    return rows


def evaluate(rows: list[dict], seed: int = 0) -> dict:
    """Per market: held-out log loss of market, model and blend, and the decision."""
    by_mk: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_mk[r["market"]].append(r)
    matches = len({r["event"] for r in rows})
    out = {}
    rng = random.Random(seed)
    for mk, rs in sorted(by_mk.items()):
        rs.sort(key=lambda r: r["kickoff"])
        cut = int(len(rs) * (1 - TEST_SHARE))
        train, test = rs[:cut], rs[cut:]
        entry: dict = {"n_rows": len(rs), "active": False}
        if len(test) >= 50 and len(train) >= 50:
            coef = fit_logistic([(logit(r["q"]), logit(r["p"])) for r in train], [r["y"] for r in train])
            ys = [r["y"] for r in test]
            entry["test"] = {
                "n": len(test),
                "market": log_loss([r["q"] for r in test], ys),
                "model": log_loss([r["p"] for r in test], ys),
                "blend": log_loss([apply(coef, r["q"], r["p"]) for r in test], ys),
            }
        t = entry.get("test")
        if matches < MIN_MATCHES:
            entry["reason"] = f"collecting: {matches:,} of {MIN_MATCHES:,} settled matches with odds"
        elif not t:
            entry["reason"] = "too few rows for this market"
        elif t["blend"] >= t["model"]:
            entry["reason"] = "the blend did not beat the results model on held-out matches"
        else:
            entry["active"] = True
            entry["reason"] = "the blend beat the results model on held-out matches"
        if len(rs) >= 100:
            xs = [(logit(r["q"]), logit(r["p"])) for r in rs]
            ys = [r["y"] for r in rs]
            entry["coef"] = fit_logistic(xs, ys)
            reps = []
            for _ in range(REPS):
                idx = [rng.randrange(len(rs)) for _ in range(len(rs))]
                reps.append(fit_logistic([xs[i] for i in idx], [ys[i] for i in idx], iters=12))
            entry["reps"] = reps
        else:
            entry["active"] = False
        out[mk] = entry
    return {"version": 1, "min_matches": MIN_MATCHES, "matches": matches,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "markets": out}


def estimate(blend: dict | None, market: str, q: float, p_main: float,
             p_reps: list[float]) -> tuple[float, float, float, str] | None:
    """Blended estimate and 90% range when the blend is active for `market`;
    None means use the results model."""
    e = (blend or {}).get("markets", {}).get(market)
    if not e or not e.get("active") or "coef" not in e:
        return None
    main = apply(e["coef"], q, p_main)
    draws = sorted(apply(c, q, pr) for c, pr in zip(e.get("reps") or [e["coef"]], p_reps or [p_main]))
    lo = draws[int(0.05 * (len(draws) - 1))]
    hi = draws[math.ceil(0.95 * (len(draws) - 1))]
    return main, min(lo, main), max(hi, main), "blend"


def guarded(q: float, p: float, lo: float, hi: float) -> tuple[float, float, float, str]:
    """Estimate while no blend is active for the market: weighted toward the
    market price. The range spans the market chance and the model's 90% range,
    because until settled odds decide between them either could be right."""
    est = apply(list(GUARD), q, p)
    return est, min(q, lo, est), max(q, hi, est), "guarded"
