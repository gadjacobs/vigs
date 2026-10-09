"""Team-strength goals model fitted to results alone (no odds).

Per league: home goals ~ Poisson(H * A[home] * D[away]), away goals ~
Poisson(A[away] * D[home]), fitted by maximum likelihood (alternating closed-form
updates). First-half goals use the league's observed share of goals scored
before half-time. Intervals come from refitting on resampled matches.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass

LINES = ("05", "15", "25", "35", "45")


@dataclass
class LeagueModel:
    attack: dict[str, float]
    defence: dict[str, float]
    home: float
    fh_share: float

    def rates(self, home: str, away: str) -> tuple[float, float] | None:
        if home not in self.attack or away not in self.attack:
            return None
        return (self.home * self.attack[home] * self.defence[away],
                self.attack[away] * self.defence[home])


def _fit_one(ms: list[tuple[int, int, int, int]], n_teams: int, iters: int) -> tuple[list, list, float]:
    scored = [0.0] * n_teams
    conceded = [0.0] * n_teams
    home_goals = 0
    for h, a, hg, ag in ms:
        scored[h] += hg
        scored[a] += ag
        conceded[h] += ag
        conceded[a] += hg
        home_goals += hg
    A, D, H = [1.0] * n_teams, [1.0] * n_teams, 1.0
    for _ in range(iters):
        den = [0.0] * n_teams
        for h, a, _, _ in ms:
            den[h] += H * D[a]
            den[a] += D[h]
        A = [scored[t] / den[t] if den[t] else 1.0 for t in range(n_teams)]
        den = [0.0] * n_teams
        for h, a, _, _ in ms:
            den[h] += A[a]
            den[a] += H * A[h]
        D = [conceded[t] / den[t] if den[t] else 1.0 for t in range(n_teams)]
        H = home_goals / sum(A[h] * D[a] for h, a, _, _ in ms)
    return A, D, H


def fit(rows: list[dict], iters: int = 60, resample: random.Random | None = None) -> dict[str, LeagueModel]:
    """Fit one model per league. `rows` are results.csv rows. With `resample`,
    matches are drawn with replacement (one bootstrap replicate)."""
    by_league: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_league[r["league"]].append(r)
    out = {}
    for lg, rs in by_league.items():
        if resample is not None:
            rs = resample.choices(rs, k=len(rs))
        teams = sorted({r["home"] for r in rs} | {r["away"] for r in rs})
        idx = {t: i for i, t in enumerate(teams)}
        ms = [(idx[r["home"]], idx[r["away"]], int(r["hg"]), int(r["ag"])) for r in rs]
        A, D, H = _fit_one(ms, len(teams), iters)
        ft = sum(hg + ag for _, _, hg, ag in ms)
        ht = sum(int(r["ht_hg"]) + int(r["ht_ag"]) for r in rs if r.get("ht_hg") not in ("", None))
        share = ht / ft if ft else 0.45
        out[lg] = LeagueModel(dict(zip(teams, A)), dict(zip(teams, D)), H, share)
    return out


def _pmf(lam: float, kmax: int = 12) -> list[float]:
    p = [math.exp(-lam)]
    for k in range(1, kmax + 1):
        p.append(p[-1] * lam / k)
    return p


def probs(lh: float, la: float, fh_share: float) -> dict[str, float]:
    """Market probabilities (vigs keys) for independent Poisson scores."""
    out: dict[str, float] = defaultdict(float)
    for pre, s in (("", 1.0), ("FH_", fh_share)):
        ph, pa = _pmf(lh * s), _pmf(la * s)
        for i, x in enumerate(ph):
            for j, y in enumerate(pa):
                w = x * y
                if not pre:
                    out["1" if i > j else "X" if i == j else "2"] += w
                    out["BY" if i and j else "BN"] += w
                for ln in LINES:
                    out[f"{pre}{'O' if i + j > int(ln) / 10 else 'U'}{ln}"] += w
    return dict(out)


def predict(models: dict[str, LeagueModel], league: str, home: str, away: str) -> dict[str, float] | None:
    m = models.get(league)
    r = m.rates(home, away) if m else None
    return probs(*r, m.fh_share) if r else None


def ensemble(rows: list[dict], reps: int = 20, seed: int = 0, iters: int = 40) -> list[dict[str, LeagueModel]]:
    rng = random.Random(seed)
    return [fit(rows, iters, rng) for _ in range(reps)]


def predict_interval(main: dict[str, LeagueModel], boots: list[dict[str, LeagueModel]],
                     league: str, home: str, away: str, market: str,
                     level: float = 0.90) -> tuple[float, float, float] | None:
    p = predict(main, league, home, away)
    if p is None:
        return None
    draws = sorted(q[market] for b in boots if (q := predict(b, league, home, away)))
    if not draws:
        return p[market], p[market], p[market]
    tail = (1 - level) / 2
    lo = draws[int(tail * (len(draws) - 1))]
    hi = draws[int(math.ceil((1 - tail) * (len(draws) - 1)))]
    return p[market], lo, hi
