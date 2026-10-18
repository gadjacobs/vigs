"""What the collected data says, refreshed hourly for the Record page.

Model-free facts only: the bookmaker's margin by market, what backing every
selection returned by odds band (favourite-longshot bias), and league profiles
from results. Each figure comes with its sample size and standard error.
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .blend import snapshots
from .data import market_groups, settle
from .odds import LIVE_DEVIG, devig

BANDS = [(1.0, 1.2), (1.2, 1.5), (1.5, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 10.0), (10.0, 1000.0)]


def family(m: str) -> str:
    if m in ("1", "X", "2"):
        return "1X2"
    if m in ("BY", "BN"):
        return "Both teams score"
    lead = {"FH": "First half ", "H": "Home team ", "A": "Away team "}.get(m.split("_")[0], "") if "_" in m else ""
    return lead + f"over/under {m[-2]}.{m[-1]}"


def _roi(profits: list[float]) -> tuple[float, float]:
    if not profits:
        return 0.0, 0.0
    se = st.pstdev(profits) / math.sqrt(len(profits)) if len(profits) > 1 else 0.0
    return sum(profits) / len(profits), se


def _ll(p: float, y: int) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return -math.log(p if y else 1 - p)


def _compare(rows: list[tuple[float, float, int]]) -> dict | None:
    """SportyBet's published probability against our market chance (Shin), by log loss."""
    if not rows:
        return None
    return {"n": len(rows), "sportybet": sum(_ll(a, y) for a, _, y in rows) / len(rows),
            "market": sum(_ll(b, y) for _, b, y in rows) / len(rows)}


# Seven chance levels, mirroring price bands (10+, 5-10, 3-5, 2-3, 1.5-2, 1.25-1.5, under
# 1.25). On held-out days (10,517 matches, Oct 2026) the lean at these levels cut log loss
# by 2.1e-4 per selection against 1.3e-4 with three levels, mostly on long shots, which
# land below their de-vigged price (10+: 4.0% landed against 4.6% priced).
CHANCE_BANDS = ((0.0, 0.1), (0.1, 0.2), (0.2, 0.33), (0.33, 0.5), (0.5, 0.67), (0.67, 0.8), (0.8, 1.0001))


LEAN_SHRINK = 2000   # as web/lib/lean.ts: examples at which a market's record counts half


def _held_out(seen: list[tuple[str, str, int, float, int]]) -> dict[str, tuple[bool, float]]:
    """Per market: does the lean learned on the earlier half of the days improve the
    log loss of the later half? Returns (improved, mean gain per selection)."""
    if not seen:
        return {}
    cut = sorted(x[0] for x in seen)[len(seen) // 2]
    learn: dict[tuple[str, int], list[float]] = defaultdict(lambda: [0, 0.0])   # n, landed - priced
    for ko, k, j, p, y in seen:
        if ko < cut:
            c = learn[(k, j)]
            c[0] += 1
            c[1] += y - p
    gain: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    for ko, k, j, p, y in seen:
        if ko < cut:
            continue
        n, d = learn.get((k, j), (0, 0.0))
        q = min(max(p + (d / n) * (n / (n + LEAN_SHRINK)) if n else p, 1e-6), 1 - 1e-6)
        p = min(max(p, 1e-6), 1 - 1e-6)
        g = gain[k]
        g[0] += 1
        g[1] += (-math.log(p if y else 1 - p)) - (-math.log(q if y else 1 - q))
    return {k: (s > 0, s / n) for k, (n, s) in gain.items() if n}


def _fh_usual(snaps: dict[str, dict], days: int = 30) -> dict[str, float]:
    if not snaps:
        return {}
    newest = max(s["kickoff"] for s in snaps.values())
    since = (datetime.fromisoformat(newest.replace("Z", "+00:00")) - timedelta(days=days)).isoformat()[:19]
    seen: dict[str, list[float]] = defaultdict(list)
    for s in snaps.values():
        o = s["odds"]
        if s["kickoff"][:19] < since or "FH_O05" not in o or "FH_U05" not in o:
            continue
        seen[f'{s["league"]}|{s["home"]}|{s["away"]}'].append(devig([o["FH_O05"], o["FH_U05"]], LIVE_DEVIG)[0])
    return {k: round(sum(v) / len(v), 4) for k, v in sorted(seen.items()) if len(v) >= 3}


def export_insights(data_dir: str) -> dict:
    with open(os.path.join(data_dir, "results.csv"), newline="", encoding="utf-8") as fh:
        results = list(csv.DictReader(fh))
    by_id = {r["event_id"]: r for r in results}
    snaps = snapshots(data_dir)
    margins: dict[str, list[float]] = defaultdict(list)
    sp_ll: list[tuple[float, float, int]] = []   # (SportyBet prob, our market chance, landed)
    bands: dict[int, list[tuple[float, float, int]]] = defaultdict(list)   # (odds, market chance, won)
    lean: dict[tuple[str, int], list[float]] = defaultdict(lambda: [0, 0, 0.0, 0.0])  # n, landed, priced, variance
    seen: list[tuple[str, str, int, float, int]] = []   # (kickoff, market, band, chance, landed) for the held-out check
    matches = 0
    for e, s in snaps.items():
        r = by_id.get(e)
        if not r:
            continue
        matches += 1
        odds = s["odds"]
        hth = int(r["ht_hg"]) if r.get("ht_hg") not in ("", None) else None
        hta = int(r["ht_ag"]) if r.get("ht_ag") not in ("", None) else None
        for g in market_groups(odds):
            total = sum(1 / odds[k] for k in g)
            margins[family(g[0])].append(total - 1)
            fair = dict(zip(g, devig([odds[k] for k in g], LIVE_DEVIG)))
            prob = s.get("prob") or {}
            for k in g:
                y = settle(k, int(r["hg"]), int(r["ag"]), hth, hta)
                if y is None:
                    continue
                i = next(i for i, (lo, hi) in enumerate(BANDS) if lo <= odds[k] < hi)
                bands[i].append((odds[k], fair[k], int(y)))
                c = lean[(k, next(j for j, (lo, hi) in enumerate(CHANCE_BANDS) if lo <= fair[k] < hi))]
                c[0] += 1
                c[1] += int(y)
                c[2] += fair[k]
                c[3] += fair[k] * (1 - fair[k])
                seen.append((s["kickoff"], k, CHANCE_BANDS.index(next(b for b in CHANCE_BANDS if b[0] <= fair[k] < b[1])), fair[k], int(y)))
                if k in prob:
                    sp_ll.append((prob[k], fair[k], int(y)))
    held = _held_out(seen)
    band_rows = []
    for i, (lo, hi) in enumerate(BANDS):
        xs = bands.get(i, [])
        if not xs:
            continue
        roi, se = _roi([(o - 1) if y else -1.0 for o, _, y in xs])
        band_rows.append({"lo": lo, "hi": hi, "n": len(xs), "landed": sum(y for *_, y in xs) / len(xs),
                          "market": sum(q for _, q, _ in xs) / len(xs),
                          "break_even": sum(1 / o for o, _, _ in xs) / len(xs), "roi": roi, "se": se})
    leagues: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        leagues[r["league"]].append(r)
    league_rows = []
    for lg, rs in sorted(leagues.items()):
        n = len(rs)
        hg = [int(r["hg"]) for r in rs]
        ag = [int(r["ag"]) for r in rs]
        ht = sum(int(r["ht_hg"]) + int(r["ht_ag"]) for r in rs if r.get("ht_hg") not in ("", None))
        goals = sum(hg) + sum(ag)
        league_rows.append({
            "league": lg, "n": n, "goals": goals / n,
            "home": sum(h > a for h, a in zip(hg, ag)) / n, "draw": sum(h == a for h, a in zip(hg, ag)) / n,
            "away": sum(h < a for h, a in zip(hg, ag)) / n, "nil_nil": sum(h + a == 0 for h, a in zip(hg, ag)) / n,
            "btts": sum(h > 0 and a > 0 for h, a in zip(hg, ag)) / n, "first_half_share": ht / goals if goals else 0.0})
    return {
        "version": 1, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "matches_with_odds": matches, "results": len(results),
        "results_from": min((r["kickoff"] for r in results), default=None),
        "margins": sorted(({"family": f, "margin": st.mean(v), "n": len(v)} for f, v in margins.items()),
                          key=lambda x: x["margin"]),
        "bands": band_rows, "leagues": league_rows,
        "sportybet_prob": _compare(sp_ll),
        # Each fixture's usual first-half goal chance (FH over 0.5, de-vigged), from its
        # replays in the last 30 days. The engine moves goals between the halves on
        # every replay and the first-half price follows; full-time prices stay put.
        # Key "league|home|away"; at least 3 replays.
        "fh_usual": _fh_usual(snaps),
        # Each market at three chance levels: how often it landed against what its
        # (de-vigged) price said. Our picks leans toward selections whose market has
        # landed above its price at that level, and away from those below it, but only
        # for markets where that lean, learned on the earlier half of the days, made
        # the later half more accurate (`held`, with the log-loss gain per selection).
        "lean": [{"market": k, "lo": CHANCE_BANDS[j][0], "hi": CHANCE_BANDS[j][1], "n": int(n), "landed": int(l),
                  "priced": pr, "z": (l - pr) / var ** 0.5 if var > 0 else 0.0,
                  "held": held.get(k, (False, 0.0))[0], "held_gain": held.get(k, (False, 0.0))[1]}
                 for (k, j), (n, l, pr, var) in sorted(lean.items()) if n >= 100],
    }
