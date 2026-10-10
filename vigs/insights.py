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
from datetime import datetime, timezone

from .blend import snapshots
from .data import market_groups, settle
from .odds import LIVE_DEVIG, devig

BANDS = [(1.0, 1.2), (1.2, 1.5), (1.5, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 10.0), (10.0, 1000.0)]


def family(m: str) -> str:
    if m in ("1", "X", "2"):
        return "1X2"
    if m in ("BY", "BN"):
        return "Both teams score"
    return ("First half " if m.startswith("FH_") else "") + f"over/under {m[-2]}.{m[-1]}"


def _roi(profits: list[float]) -> tuple[float, float]:
    if not profits:
        return 0.0, 0.0
    se = st.pstdev(profits) / math.sqrt(len(profits)) if len(profits) > 1 else 0.0
    return sum(profits) / len(profits), se


def export_insights(data_dir: str) -> dict:
    with open(os.path.join(data_dir, "results.csv"), newline="", encoding="utf-8") as fh:
        results = list(csv.DictReader(fh))
    by_id = {r["event_id"]: r for r in results}
    snaps = snapshots(data_dir)
    margins: dict[str, list[float]] = defaultdict(list)
    bands: dict[int, list[tuple[float, float, int]]] = defaultdict(list)   # (odds, market chance, won)
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
            for k in g:
                y = settle(k, int(r["hg"]), int(r["ag"]), hth, hta)
                if y is None:
                    continue
                i = next(i for i, (lo, hi) in enumerate(BANDS) if lo <= odds[k] < hi)
                bands[i].append((odds[k], fair[k], int(y)))
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
    }
