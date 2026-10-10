"""Scorecard of the pick ledger, exported as JSON for the web app's Record page."""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, timezone

from .grading import confidence
from .ledger import Ledger


def _ci(profits: list[float], seed: int = 0, reps: int = 2000) -> tuple[float, float]:
    if len(profits) < 2:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(profits)
    means = sorted(sum(rng.choices(profits, k=n)) / n for _ in range(reps))
    return means[int(0.05 * reps)], means[int(0.95 * reps) - 1]


def _group(rows: list[tuple[dict, dict | None]]) -> dict:
    done = [(p, s) for p, s in rows if s is not None and not s.get("void")]
    profits = [p["odds"] - 1 if s["won"] else -1.0 for p, s in done]
    lo, hi = _ci(profits)
    return {
        "picks": len(rows), "settled": len(done), "open": len(rows) - len(done),
        "hits": sum(bool(s["won"]) for _, s in done),
        "expected_vig": sum(p["estimate"] for p, _ in done),
        "expected_market": sum(p["market_prob"] for p, _ in done),
        "roi": sum(profits) / len(profits) if profits else 0.0,
        "roi_low": lo, "roi_high": hi,
    }


def export_record(ledger: Ledger, recent: int = 150) -> dict:
    picks, settled = ledger.picks(), ledger.settlements()
    rows = [(p, settled.get(pid)) for pid, p in picks.items()]
    by_grade: dict[str, list] = defaultdict(list)
    by_market: dict[tuple[str, str], list] = defaultdict(list)
    by_conf: dict[str, list] = defaultdict(list)
    for p, s in rows:
        by_grade[p["grade"]].append((p, s))
        if p.get("ci_low") is not None and p.get("ci_high") is not None:
            by_conf[confidence(p["ci_low"], p["ci_high"])].append((p, s))
        by_market[(p["market"], p["grade"])].append((p, s))

    # Cumulative flat-stake profit per grade, in kickoff order.
    curve: dict[str, list] = defaultdict(list)
    for g, rs in by_grade.items():
        total = 0.0
        for p, s in sorted((r for r in rs if r[1] and not r[1].get("void")),
                           key=lambda r: r[0].get("kickoff") or ""):
            total += p["odds"] - 1 if s["won"] else -1.0
            curve[g].append([p.get("kickoff"), round(total, 4)])

    # Calibration: Vig estimate vs what happened, 5-point bins.
    bins: dict[int, list[float]] = defaultdict(lambda: [0, 0.0, 0.0, 0])
    for p, s in rows:
        if s and not s.get("void"):
            b = bins[min(int(p["estimate"] * 20), 19)]
            b[0] += 1
            b[1] += p["estimate"]
            b[2] += p["market_prob"]
            b[3] += bool(s["won"])
    calibration = [{"bin": f"{k * 5}-{k * 5 + 5}%", "n": int(n), "estimate": e / n,
                    "market": m / n, "hit_rate": h / n}
                   for k, (n, e, m, h) in sorted(bins.items())]

    # Codes booked in the app ("vig" = cooked slips): each code as one
    # accumulator, and its scored legs as singles.
    settled_codes = ledger.user_code_settlements()
    codes = []
    for key, c in ledger.user_codes().items():
        scored = [leg for leg in c["legs"] if leg.get("scored")]
        st = settled_codes.get(key)
        won_by = {o["event_id"]: o["won"] for o in (st or {}).get("legs", [])}
        odds = est = mkt = 1.0
        for leg in scored:
            odds *= leg.get("odds") or 1.0
            est *= leg.get("estimate") or 0.0
            mkt *= leg.get("market_prob") or 0.0
        codes.append({"code": c["code"], "user": c.get("user"), "origin": c.get("origin") or "",
                      "booked_at": c["booked_at"], "legs": len(c["legs"]), "scored": len(scored),
                      "odds": odds, "estimate": est, "market_prob": mkt,
                      "won": None if not st else st["won"],
                      "_legs": [(leg, won_by.get(leg["event_id"])) for leg in scored] if st else []})

    def code_group(cs: list[dict]) -> dict:
        done = [c for c in cs if c["won"] is not None and c["scored"]]
        profits = [c["odds"] - 1 if c["won"] else -1.0 for c in done]
        legs = [(l, w) for c in done for l, w in c["_legs"] if w is not None]
        return {
            "codes": len(cs), "settled": len(done), "landed": sum(bool(c["won"]) for c in done),
            "expected_vig": sum(c["estimate"] for c in done), "expected_market": sum(c["market_prob"] for c in done),
            "roi": sum(profits) / len(profits) if profits else 0.0,
            "legs": {"settled": len(legs), "hits": sum(bool(w) for _, w in legs),
                     "expected_vig": sum(l.get("estimate") or 0 for l, _ in legs),
                     "expected_market": sum(l.get("market_prob") or 0 for l, _ in legs)},
            "recent": [{k: v for k, v in c.items() if k != "_legs"}
                       for c in sorted(cs, key=lambda c: -c["booked_at"])[:30]],
        }

    people = [c for c in codes if c["user"] != "vig"]
    by_user: dict[str, list] = defaultdict(list)
    for c in people:
        by_user[c["user"] or "me"].append(c)
    cooked = [c for c in codes if c["user"] == "vig"]
    by_style: dict[str, list] = defaultdict(list)
    for c in cooked:
        by_style[c["origin"].removeprefix("slate:")].append(c)
    mycodes = dict(code_group(people), by_user={u: code_group(cs) for u, cs in by_user.items()})
    slates = dict(code_group(cooked), by_style={k: code_group(cs) for k, cs in by_style.items()})

    latest = sorted(rows, key=lambda r: r[0].get("kickoff") or "", reverse=True)[:recent]
    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "chain": {"records": len(ledger.records), "head": ledger.head, "verified": True},
        "grades": {g: _group(rs) for g, rs in by_grade.items()},
        "confidence": {c: _group(rs) for c, rs in by_conf.items()},
        "mycodes": mycodes,
        "slates": slates,
        "ourpicks": _group([(p, s) for p, s in rows if str(p.get("sheet_id", "")).startswith("ourpicks-")]),
        "markets": [dict(market=m, grade=g, **_group(rs)) for (m, g), rs in sorted(by_market.items())],
        "curve": curve,
        "calibration": calibration,
        "recent": [{
            "kickoff": p.get("kickoff"), "fixture": p["fixture"], "market": p["market"],
            "odds": p["odds"], "estimate": p["estimate"], "market_prob": p["market_prob"],
            "grade": p["grade"], "generated_at": p.get("generated_at"),
            "won": None if s is None else s["won"], "score": None if s is None else s.get("score"),
        } for p, s in latest],
    }
