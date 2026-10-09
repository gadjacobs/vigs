"""Mining, validation and walk-forward accumulator simulation."""
from __future__ import annotations

import itertools
import math
import random
from dataclasses import dataclass

from .data import Match, group_weeks, settle
from .patterns import Candidate, State
from .stats import (bh_qvalues, bootstrap_ci, poisson_binomial_sf, z_vs_fair)


@dataclass(eq=False)
class Bet:
    cand: str
    match: Match
    market: str
    odds: float
    q: float                    # de-vigged market probability
    hit: bool | None

    @property
    def t(self) -> int:
        return self.match.t


@dataclass
class Stats:
    n: int = 0
    hits: int = 0
    hit_rate: float = 0.0
    mean_odds: float = 0.0
    roi: float = 0.0
    z: float = 0.0              # hits vs de-vigged market (information in the pattern)
    p: float = 1.0
    ci: tuple[float, float] | None = None


def build_bets(matches: list[Match], candidates: list[Candidate]) -> dict[str, list[Bet]]:
    """Point-in-time signals: week w is scored with state built from weeks < w."""
    st = State()
    out: dict[str, list[Bet]] = {c.name: [] for c in candidates}
    for week in group_weeks(matches):
        for c in candidates:
            for m in week:
                mk = c.fn(st, m)
                if mk is None or mk not in m.fair:
                    continue
                hit = settle(mk, m.hg, m.ag) if m.settled else None
                out[c.name].append(Bet(c.name, m, mk, m.odds[mk], m.fair[mk], hit))
        st.update(week)
    return out


def evaluate(bets: list[Bet], ci: bool = False) -> Stats:
    done = [b for b in bets if b.hit is not None]
    n = len(done)
    if n == 0:
        return Stats()
    hits = sum(b.hit for b in done)
    profits = [b.odds - 1 if b.hit else -1.0 for b in done]
    z, p = z_vs_fair(hits, [b.q for b in done])
    return Stats(n, hits, hits / n, sum(b.odds for b in done) / n, sum(profits) / n, z, p,
                 bootstrap_ci(profits) if ci else None)


@dataclass
class MineRow:
    name: str
    train: Stats
    test: Stats
    bh_q: float
    test_p_adj: float
    verdict: str


def mine(bets_by_cand: dict[str, list[Bet]], n_weeks: int, split: float = 0.7,
         top: int = 5, min_train: int = 30) -> tuple[list[MineRow], int, int]:
    """Rank every candidate on the training weeks, then re-test the best on
    untouched holdout weeks. Returns (top rows, K tested, split week)."""
    split_t = max(1, int(n_weeks * split))
    train: dict[str, Stats] = {}
    for name, bets in bets_by_cand.items():
        s = evaluate([b for b in bets if b.t < split_t])
        if s.n >= min_train:
            train[name] = s
    if not train:
        return [], 0, split_t
    names = list(train)
    q = dict(zip(names, bh_qvalues([train[n].p for n in names])))
    ranked = sorted(names, key=lambda n: -train[n].z)[:top]
    rows = []
    for name in ranked:
        test = evaluate([b for b in bets_by_cand[name] if b.t >= split_t], ci=True)
        adj = min(1.0, test.p * top)
        if q[name] < 0.05 and adj < 0.05 and test.roi > 0:
            verdict = "STRONG"
        elif q[name] < 0.10 and test.z > 0:
            verdict = "tentative"
        else:
            verdict = "no evidence"
        rows.append(MineRow(name, train[name], test, q[name], adj, verdict))
    return rows, len(train), split_t


# ------------------------------------------------------------ accumulators --

def build_accas(picks: list[tuple[Bet, float]], lo: float, hi: float, max_accas: int = 3,
                min_legs: int = 2, max_legs: int = 8, pool: int = 14) -> list[tuple[Bet, ...]]:
    """Combine picks (one leg per match) into accumulators with combined odds in
    [lo, hi]. Prefers combos with the highest summed pattern score; successive
    accas must differ by at least two legs."""
    best: dict[int, tuple[float, Bet]] = {}
    for b, score in picks:
        key = id(b.match)
        if key not in best or score > best[key][0]:
            best[key] = (score, b)
    legs = sorted(best.values(), key=lambda x: -x[0])[:pool]
    found = []
    for size in range(min_legs, min(max_legs, len(legs)) + 1):
        for combo in itertools.combinations(legs, size):
            prod = math.prod(b.odds for _, b in combo)
            if lo <= prod <= hi:
                found.append((sum(s for s, _ in combo), tuple(b for _, b in combo)))
    found.sort(key=lambda x: -x[0])
    chosen: list[tuple[Bet, ...]] = []
    for _, combo in found:
        ids = {id(b) for b in combo}
        if all(len(ids - {id(b) for b in c}) >= 2 for c in chosen):
            chosen.append(combo)
        if len(chosen) >= max_accas:
            break
    return chosen


class _Cum:
    __slots__ = ("n", "hits", "sq", "var")

    def __init__(self) -> None:
        self.n = self.hits = 0
        self.sq = self.var = 0.0

    def add(self, b: Bet) -> None:
        self.n += 1
        self.hits += bool(b.hit)
        self.sq += b.q
        self.var += b.q * (1 - b.q)

    def z(self) -> float:
        return (self.hits - self.sq) / math.sqrt(self.var) if self.var > 0 else 0.0


def select_patterns(cum: dict[str, _Cum], top: int, min_n: int, min_z: float) -> list[tuple[str, float]]:
    ok = [(n, c.z()) for n, c in cum.items() if c.n >= min_n and c.z() >= min_z]
    return sorted(ok, key=lambda x: -x[1])[:top]


@dataclass
class AccaResult:
    t: int
    legs: tuple[Bet, ...]
    odds: float
    fair_p: float
    hit: bool


def walk_forward(bets_by_cand: dict[str, list[Bet]], n_weeks: int, warmup: int = 25,
                 top: int = 5, lo: float = 20.0, hi: float = 50.0, max_accas: int = 3,
                 min_n: int = 20, min_z: float = 1.0) -> list[AccaResult]:
    by_t: dict[str, dict[int, list[Bet]]] = {}
    for name, bets in bets_by_cand.items():
        d: dict[int, list[Bet]] = {}
        for b in bets:
            d.setdefault(b.t, []).append(b)
        by_t[name] = d
    cum = {name: _Cum() for name in bets_by_cand}
    results: list[AccaResult] = []
    for t in range(n_weeks):
        if t >= warmup:
            chosen = select_patterns(cum, top, min_n, min_z)
            picks = [(b, z) for name, z in chosen for b in by_t[name].get(t, [])]
            for combo in build_accas(picks, lo, hi, max_accas):
                results.append(AccaResult(
                    t, combo, math.prod(b.odds for b in combo),
                    math.prod(b.q for b in combo), all(b.hit for b in combo)))
        for name in cum:
            for b in by_t[name].get(t, []):
                cum[name].add(b)
    return results


@dataclass
class WalkSummary:
    n: int
    hits: int
    expected_hits: float
    p_vs_fair: float
    roi: float
    baseline_mean_roi: float
    baseline_pct: float          # share of random-acca runs the strategy beat
    mean_odds: float


def summarize_walk(results: list[AccaResult], matches: list[Match], lo: float, hi: float,
                   sims: int = 300, seed: int = 7) -> WalkSummary:
    n = len(results)
    if n == 0:
        return WalkSummary(0, 0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0)
    hits = sum(r.hit for r in results)
    roi = sum(r.odds - 1 if r.hit else -1.0 for r in results) / n
    weeks = {w[0].t: [m for m in w if m.settled] for w in group_weeks(matches)}
    rng = random.Random(seed)
    sim_rois = []
    for _ in range(sims):
        total = used = 0
        for r in results:
            pool = weeks[r.t]
            k = len(r.legs)
            for _ in range(300):
                sel = rng.sample(pool, k)
                legs = [(rng.choice("1X2"), m) for m in sel]
                prod = math.prod(m.odds[mk] for mk, m in legs)
                if lo <= prod <= hi:
                    ok = all(settle(mk, m.hg, m.ag) for mk, m in legs)
                    total += prod - 1 if ok else -1
                    used += 1
                    break
        if used:
            sim_rois.append(total / used)
    beat = sum(roi > s for s in sim_rois) / len(sim_rois) if sim_rois else 0.0
    return WalkSummary(
        n, hits, sum(r.fair_p for r in results),
        poisson_binomial_sf(hits, [r.fair_p for r in results]), roi,
        sum(sim_rois) / len(sim_rois) if sim_rois else 0.0, beat,
        sum(r.odds for r in results) / n)
