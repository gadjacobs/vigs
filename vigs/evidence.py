"""Slices: a market at a price (odds bucket), optionally narrowed by one context.

Every slice includes the odds bucket so the matches in it are priced alike;
a pooled rate across very different prices says nothing about a selection's
own break-even. Contexts are computed from rounds strictly before the match.
A slice's evidence is its history rate against break-even, validated
walk-forward on rounds it never trained on, and corrected for the number of
slices tested.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from .data import Match, group_weeks
from .grading import RANK, GradeConfig, Graded, grade, posterior
from .stats import bh_qvalues, p_rate_above

STATS_VERSION = "1"
LAGOS = timedelta(hours=1)          # Africa/Lagos is UTC+1, no daylight saving
DIMS = ("league", "odds", "stage", "hour", "gap", "home_team", "away_team",
        "pair", "form_home", "form_away", "prev_home", "prev_away")
ODDS_EDGES = (1.0, 1.05, 1.10, 1.15, 1.20, 1.30, 1.40, 1.55, 1.70, 1.85, 2.0, 2.3, 2.6,
              3.0, 3.5, 4.2, 5.0, 6.5, 8.0, 11.0, 16.0, math.inf)
EXACT_MAX = 400


def odds_bucket(o: float) -> str:
    for lo, hi in zip(ODDS_EDGES, ODDS_EDGES[1:]):
        if lo <= o < hi:
            return f"{lo:.2f}+" if hi == math.inf else f"{lo:.2f}-{hi:.2f}"
    return "?"


class Tracker:
    """Point-in-time team and table state."""

    def __init__(self) -> None:
        self.points: dict[tuple[str, str], list[int]] = defaultdict(list)
        self.tables: dict[tuple[str, str], dict[str, list[int]]] = defaultdict(dict)
        self.teams: dict[str, set[str]] = defaultdict(set)

    def _position(self, league: str, season: str, team: str) -> int | None:
        table = self.tables.get((league, season))
        if not table or team not in table:
            return None
        order = sorted(table, key=lambda t: (-table[t][0], -table[t][1], -table[t][2], t))
        return order.index(team) + 1

    def context(self, m: Match) -> dict[str, str]:
        lg = m.league
        self.teams[lg].update((m.home, m.away))
        ctx = {"league": lg or "-", "home_team": m.home, "away_team": m.away,
               "pair": f"{m.home} v {m.away}"}
        season_len = 2 * (len(self.teams[lg]) - 1)
        if season_len > 0:
            frac = m.week / season_len
            ctx["stage"] = "early" if frac <= 1 / 3 else "mid" if frac <= 2 / 3 else "late"
        if m.kickoff is not None:
            h = (m.kickoff + LAGOS).hour
            ctx["hour"] = f"{h // 6 * 6:02d}-{h // 6 * 6 + 5:02d}"
        ph = self._position(lg, m.season, m.home)
        pa = self._position(lg, m.season, m.away)
        if ph is not None and pa is not None:
            g = ph - pa
            ctx["gap"] = ("home far above" if g <= -8 else "home above" if g <= -3 else
                          "level" if g <= 2 else "away above" if g <= 7 else "away far above")
        for side, team in (("home", m.home), ("away", m.away)):
            pts = self.points[(lg, team)]
            if len(pts) >= 3:
                s = sum(pts[-3:])
                ctx[f"form_{side}"] = "poor" if s <= 3 else "middling" if s <= 6 else "good"
            if pts:
                ctx[f"prev_{side}"] = {3: "won", 1: "drew", 0: "lost"}[pts[-1]]
        return ctx

    def update(self, week: list[Match]) -> None:
        for m in week:
            if not m.settled:
                continue
            ph = 3 if m.hg > m.ag else 1 if m.hg == m.ag else 0
            pa = 3 if m.ag > m.hg else 1 if m.hg == m.ag else 0
            self.points[(m.league, m.home)].append(ph)
            self.points[(m.league, m.away)].append(pa)
            table = self.tables[(m.league, m.season)]
            for team, pts, gf, ga in ((m.home, ph, m.hg, m.ag), (m.away, pa, m.ag, m.hg)):
                row = table.setdefault(team, [0, 0, 0])
                row[0] += pts
                row[1] += gf - ga
                row[2] += gf


@dataclass(eq=False)
class Obs:
    match: Match
    market: str
    odds: float
    q: float                    # market chance (de-vigged)
    hit: bool | None
    ctx: dict[str, str]
    keys: list[str] = field(default_factory=list)

    @property
    def t(self) -> int:
        return self.match.t


def slice_key(market: str, items: list[tuple[str, str]]) -> str:
    items = sorted(items, key=lambda kv: DIMS.index(kv[0]))
    return "|".join([market] + [f"{k}={v}" for k, v in items])


def keys_for(market: str, ctx: dict[str, str], dims: tuple[str, ...]) -> list[str]:
    price = ("odds", ctx["odds"])
    return [slice_key(market, [price])] + [
        slice_key(market, [price, (d, ctx[d])]) for d in dims if d != "odds" and d in ctx]


def observe(matches: list[Match], markets: set[str] | None = None) -> list[Obs]:
    """One observation per (match, market with a de-vigged price)."""
    tr = Tracker()
    out: list[Obs] = []
    for week in group_weeks(matches):
        for m in week:
            ctx = tr.context(m)
            for mk, q in m.fair.items():
                if markets and mk not in markets:
                    continue
                hit = m.outcome(mk)
                if m.settled and hit is None:
                    continue                # e.g. first half without half-time score
                odds = m.odds[mk]
                out.append(Obs(m, mk, odds, q, hit, dict(ctx, odds=odds_bucket(odds))))
        tr.update(week)
    return out


@dataclass
class SliceStat:
    n: int = 0
    hits: int = 0
    sum_q: float = 0.0
    sum_be: float = 0.0
    var_be: float = 0.0
    bes: list[float] | None = field(default_factory=list)
    p: float = 1.0
    q_fdr: float | None = None
    oos_n: int = 0
    oos_sum: float = 0.0
    oos_sq: float = 0.0

    def add(self, o: Obs) -> None:
        be = 1.0 / o.odds
        self.n += 1
        self.hits += bool(o.hit)
        self.sum_q += o.q
        self.sum_be += be
        self.var_be += be * (1 - be)
        if self.bes is not None:
            self.bes.append(be)
            if len(self.bes) > EXACT_MAX:
                self.bes = None

    @property
    def market_mean(self) -> float:
        return self.sum_q / self.n

    @property
    def be_mean(self) -> float:
        return self.sum_be / self.n

    @property
    def oos_roi(self) -> float:
        return self.oos_sum / self.oos_n if self.oos_n else 0.0

    def oos_interval(self, z: float = 1.645) -> tuple[float, float]:
        if self.oos_n < 2:
            return (-math.inf, math.inf)
        mean = self.oos_roi
        var = max(self.oos_sq / self.oos_n - mean * mean, 0.0) * self.oos_n / (self.oos_n - 1)
        half = z * math.sqrt(var / self.oos_n)
        return mean - half, mean + half

    def validated(self, min_n: int) -> bool | None:
        if self.oos_n < 30:
            return None
        lo, _ = self.oos_interval()
        return lo > 0 or (self.oos_roi > 0 and self.oos_n >= min_n)

    def fdr_pass(self, alpha: float) -> bool | None:
        return None if self.q_fdr is None else self.q_fdr <= alpha


@dataclass
class Analysis:
    slices: dict[str, SliceStat]
    dims: tuple[str, ...]
    collected_days: float | None
    n_tested: int
    n_settled_matches: int
    test_rounds: int
    cfg: GradeConfig
    fdr_alpha: float
    overall: tuple[int, float, float]          # hits, sum q, var q over all observations

    def grade_slice(self, key: str) -> Graded:
        st = self.slices[key]
        return grade(1.0 / st.be_mean, st.market_mean, st.n, st.hits, st.market_mean,
                     st.validated(self.cfg.min_n), st.fdr_pass(self.fdr_alpha),
                     self.collected_days, self.cfg)


def active_dims(obs: list[Obs]) -> tuple[str, ...]:
    """Dimensions that actually vary in this data (a constant one adds nothing)."""
    seen: dict[str, set[str]] = defaultdict(set)
    for o in obs:
        for d, v in o.ctx.items():
            seen[d].add(v)
    return tuple(d for d in DIMS if len(seen[d]) > 1)


def analyze(matches: list[Match], markets: set[str] | None = None,
            cfg: GradeConfig = GradeConfig(), train_frac: float = 0.5, folds: int = 5,
            min_test_n: int = 30, fdr_alpha: float = 0.10) -> tuple[Analysis, list[Obs]]:
    """Slice statistics over all settled rounds, plus walk-forward validation:
    the test rounds are split into folds; each fold is judged using only slice
    stats frozen at its start, and a slice's out-of-sample record is the
    profit of the bets it would have recommended at the time."""
    obs = observe(matches, markets)
    dims = active_dims([o for o in obs if o.hit is not None])
    for o in obs:
        o.keys = keys_for(o.market, o.ctx, dims)
    settled = [o for o in obs if o.hit is not None]
    by_t: dict[int, list[Obs]] = defaultdict(list)
    for o in settled:
        by_t[o.t].append(o)
    ts = sorted(by_t)
    test_ts = ts[int(len(ts) * train_frac):]
    size = max(1, math.ceil(len(test_ts) / max(folds, 1)))
    fold_starts = set(test_ts[::size])

    stats: dict[str, SliceStat] = defaultdict(SliceStat)
    frozen: dict[str, tuple[int, int, float]] | None = None
    for t in ts:
        if t in fold_starts:
            frozen = {k: (s.n, s.hits, s.sum_q) for k, s in stats.items()}
        if frozen is not None:
            for o in by_t[t]:
                profit = o.odds - 1.0 if o.hit else -1.0
                for key in o.keys:
                    f = frozen.get(key)
                    if f is None or f[0] < min_test_n:
                        continue
                    a, b = posterior(f[1], f[0], f[2] / f[0], cfg.k)
                    if a / (a + b) * o.odds > 1.0:       # it would have been picked
                        st = stats[key]
                        st.oos_n += 1
                        st.oos_sum += profit
                        st.oos_sq += profit * profit
        for o in by_t[t]:
            for key in o.keys:
                stats[key].add(o)

    tested = [k for k, s in stats.items() if s.n >= min_test_n]
    for k in tested:
        s = stats[k]
        if s.bes is not None:
            s.p = p_rate_above(s.hits, s.bes)
        else:
            z = (s.hits - 0.5 - s.sum_be) / math.sqrt(s.var_be)
            s.p = 1.0 - 0.5 * (1.0 + math.erf(z / math.sqrt(2)))
    for k, q in zip(tested, bh_qvalues([stats[k].p for k in tested])):
        stats[k].q_fdr = q

    kicks = [o.match.kickoff for o in settled if o.match.kickoff is not None]
    days = (max(kicks) - min(kicks)).total_seconds() / 86400 if kicks else None
    hits = sum(o.hit for o in settled)
    sq = sum(o.q for o in settled)
    vq = sum(o.q * (1 - o.q) for o in settled)
    n_matches = len({id(o.match) for o in settled})
    return Analysis(dict(stats), dims, days, len(tested), n_matches, len(test_ts),
                    cfg, fdr_alpha, (hits, sq, vq)), obs


@dataclass
class GradedPick:
    obs: Obs
    graded: Graded
    slice_key: str
    slices_considered: int


def grade_obs(o: Obs, an: Analysis) -> GradedPick:
    """Grade a selection by the strongest slice it belongs to. Choosing the best
    of many slices is optimistic, which is why Solid also needs walk-forward
    validation and the false-discovery check."""
    best: tuple[tuple[int, float], str, Graded] | None = None
    considered = 0
    for key in o.keys:
        st = an.slices.get(key)
        if st is None or st.n == 0:
            continue
        considered += 1
        g = grade(o.odds, o.q, st.n, st.hits, st.market_mean, st.validated(an.cfg.min_n),
                  st.fdr_pass(an.fdr_alpha), an.collected_days, an.cfg)
        rank = (RANK[g.grade], g.p_beats)
        if best is None or rank > best[0]:
            best = (rank, key, g)
    if best is None:
        return GradedPick(o, grade(o.odds, o.q, 0, 0, cfg=an.cfg), o.market, 0)
    return GradedPick(o, best[2], best[1], considered)


def calibration(obs: list[Obs], bins: int = 10) -> list[tuple[str, int, float, float, float]]:
    """(market-chance bin, n, mean market chance, history rate, mean break-even)."""
    acc: dict[int, list[float]] = defaultdict(lambda: [0, 0.0, 0.0, 0.0])
    for o in obs:
        if o.hit is None:
            continue
        b = min(int(o.q * bins), bins - 1)
        a = acc[b]
        a[0] += 1
        a[1] += o.q
        a[2] += o.hit
        a[3] += 1.0 / o.odds
    rows = []
    for b in sorted(acc):
        n, sq, h, sbe = acc[b]
        rows.append((f"{b * 100 // bins}-{(b + 1) * 100 // bins}%", int(n), sq / n, h / n, sbe / n))
    return rows
