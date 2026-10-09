"""Results-only study: base rates, and whether the engine has any memory.

No odds needed. Each test compares what happened after a condition (a win
streak, a draw drought, a high-scoring game, an hour of day) with what the
same team at the same venue does on average. If the engine is a memoryless
RNG on stable team strengths, every z-score sits near zero.
"""
from __future__ import annotations

import csv
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from .stats import bh_qvalues

LAGOS = timedelta(hours=1)


@dataclass
class Game:
    kickoff: datetime
    league: str
    team: str
    venue: str          # "H" or "A"
    gf: int
    ga: int
    ht: int | None      # first-half total goals

    @property
    def res(self) -> str:
        return "W" if self.gf > self.ga else "D" if self.gf == self.ga else "L"


def load_results(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    rows.sort(key=lambda r: (r["kickoff"], r["league"], r["event_id"]))
    return rows


def _games(rows: list[dict]) -> dict[tuple[str, str], list[Game]]:
    out: dict[tuple[str, str], list[Game]] = defaultdict(list)
    for r in rows:
        ko = datetime.fromisoformat(r["kickoff"].replace("Z", "+00:00"))
        hg, ag = int(r["hg"]), int(r["ag"])
        ht = int(r["ht_hg"]) + int(r["ht_ag"]) if r.get("ht_hg") not in ("", None) else None
        out[(r["league"], r["home"])].append(Game(ko, r["league"], r["home"], "H", hg, ag, ht))
        out[(r["league"], r["away"])].append(Game(ko, r["league"], r["away"], "A", ag, hg, ht))
    return out


@dataclass
class Effect:
    name: str
    n: int
    observed: float
    expected: float
    z: float
    p: float = 1.0
    q: float = 1.0


def _z_two_sided(obs: float, exp: float, var: float) -> tuple[float, float]:
    if var <= 0:
        return 0.0, 1.0
    z = (obs - exp) / math.sqrt(var)
    return z, math.erfc(abs(z) / math.sqrt(2))


def memory_tests(rows: list[dict]) -> list[Effect]:
    """Does a team's recent past change its next result beyond its own base rate?"""
    games = _games(rows)
    base: dict[tuple, dict[str, float]] = {}
    for key, gs in games.items():
        for venue in "HA":
            g = [x for x in gs if x.venue == venue]
            if g:
                n = len(g)
                base[key + (venue,)] = {
                    "W": sum(x.res == "W" for x in g) / n,
                    "D": sum(x.res == "D" for x in g) / n,
                    "O25": sum(x.gf + x.ga >= 3 for x in g) / n,
                    "SC": sum(x.gf > 0 for x in g) / n,
                }

    conditions = {
        "won last match": lambda h: h[-1].res == "W",
        "lost last match": lambda h: h[-1].res == "L",
        "drew last match": lambda h: h[-1].res == "D",
        "won last 3": lambda h: len(h) >= 3 and all(x.res == "W" for x in h[-3:]),
        "lost last 3": lambda h: len(h) >= 3 and all(x.res == "L" for x in h[-3:]),
        "no draw in last 6": lambda h: len(h) >= 6 and all(x.res != "D" for x in h[-6:]),
        "4+ goals in last match": lambda h: h[-1].gf + h[-1].ga >= 4,
        "0-0 or 1-0 last match": lambda h: h[-1].gf + h[-1].ga <= 1,
        "failed to score last 2": lambda h: len(h) >= 2 and all(x.gf == 0 for x in h[-2:]),
    }
    outcomes = {"win": ("W", lambda g: g.res == "W"), "draw": ("D", lambda g: g.res == "D"),
                "over 2.5": ("O25", lambda g: g.gf + g.ga >= 3),
                "scores": ("SC", lambda g: g.gf > 0)}
    acc: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0, 0.0, 0.0, 0.0])
    for key, gs in games.items():
        for i in range(1, len(gs)):
            hist, g = gs[:i], gs[i]
            b = base[key + (g.venue,)]
            for cname, cond in conditions.items():
                if not cond(hist):
                    continue
                for oname, (bkey, hit) in outcomes.items():
                    a = acc[(cname, oname)]
                    p = b[bkey]
                    a[0] += 1
                    a[1] += hit(g)
                    a[2] += p
                    a[3] += p * (1 - p)
    out = []
    for (cname, oname), (n, obs, exp, var) in acc.items():
        # Each match appears once per team: halve the effective sample to stay conservative.
        z, p = _z_two_sided(obs, exp, var * 2)
        out.append(Effect(f"after '{cname}': {oname}", int(n), obs / n, exp / n, z, p))
    for e, q in zip(out, bh_qvalues([e.p for e in out])):
        e.q = q
    return sorted(out, key=lambda e: -abs(e.z))


def hour_tests(rows: list[dict]) -> list[Effect]:
    """Goals per match by Lagos hour, against the league's own average."""
    by_league: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        by_league[r["league"]].append(int(r["hg"]) + int(r["ag"]))
    mean = {lg: sum(v) / len(v) for lg, v in by_league.items()}
    var = {lg: sum((x - mean[lg]) ** 2 for x in v) / len(v) for lg, v in by_league.items()}
    acc: dict[int, list[float]] = defaultdict(lambda: [0, 0.0, 0.0, 0.0])
    for r in rows:
        h = (datetime.fromisoformat(r["kickoff"].replace("Z", "+00:00")) + LAGOS).hour
        a = acc[h]
        a[0] += 1
        a[1] += int(r["hg"]) + int(r["ag"])
        a[2] += mean[r["league"]]
        a[3] += var[r["league"]]
    out = []
    for h, (n, obs, exp, v) in sorted(acc.items()):
        z, p = _z_two_sided(obs, exp, v)
        out.append(Effect(f"{h:02d}:00 Lagos: goals per match", int(n), obs / n, exp / n, z, p))
    for e, q in zip(out, bh_qvalues([e.p for e in out])):
        e.q = q
    return out


def stability(rows: list[dict]) -> list[tuple[str, int, float]]:
    """Per league: correlation of each team's home-win rate between the first
    and second half of the window. Near 1 means stable strengths; near 0 means
    strengths reshuffle (e.g. by season)."""
    out = []
    leagues = sorted({r["league"] for r in rows})
    for lg in leagues:
        rs = [r for r in rows if r["league"] == lg]
        half = len(rs) // 2
        rates = []
        for part in (rs[:half], rs[half:]):
            w: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            for r in part:
                w[r["home"]][0] += int(r["hg"]) > int(r["ag"])
                w[r["home"]][1] += 1
            rates.append({t: a / b for t, (a, b) in w.items() if b >= 20})
        teams = sorted(set(rates[0]) & set(rates[1]))
        if len(teams) < 3:
            continue
        x = [rates[0][t] for t in teams]
        y = [rates[1][t] for t in teams]
        mx, my = sum(x) / len(x), sum(y) / len(y)
        sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
        sx = math.sqrt(sum((a - mx) ** 2 for a in x))
        sy = math.sqrt(sum((b - my) ** 2 for b in y))
        out.append((lg, len(teams), sxy / (sx * sy) if sx and sy else 0.0))
    return out


def base_rates(rows: list[dict]) -> list[tuple[str, int, dict[str, float]]]:
    out = []
    for lg in sorted({r["league"] for r in rows}):
        rs = [r for r in rows if r["league"] == lg]
        n = len(rs)
        g = [(int(r["hg"]), int(r["ag"])) for r in rs]
        ht = [int(r["ht_hg"]) + int(r["ht_ag"]) for r in rs if r.get("ht_hg") not in ("", None)]
        out.append((lg, n, {
            "home": sum(a > b for a, b in g) / n, "draw": sum(a == b for a, b in g) / n,
            "away": sum(a < b for a, b in g) / n, "goals": sum(a + b for a, b in g) / n,
            "O1.5": sum(a + b >= 2 for a, b in g) / n, "O2.5": sum(a + b >= 3 for a, b in g) / n,
            "BTTS": sum(a > 0 and b > 0 for a, b in g) / n,
            "FH O0.5": sum(h >= 1 for h in ht) / len(ht) if ht else float("nan")}))
    return out
