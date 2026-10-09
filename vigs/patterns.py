"""Candidate pattern library.

Every pattern is a pure function of (state, match) -> market | None, where
`state` only contains gameweeks strictly before the match: no look-ahead.
All parameters are fixed here, up front, so the number of hypotheses tested
(K) is known and can be corrected for.
"""
from __future__ import annotations

from collections import defaultdict, namedtuple
from dataclasses import dataclass
from typing import Callable

from .data import Match

TG = namedtuple("TG", "win draw btts resid")   # one team's finished game


class State:
    def __init__(self) -> None:
        self.games: dict[str, list[TG]] = defaultdict(list)
        self.week_goals: list[float] = []      # avg total goals per settled week

    def update(self, week: list[Match]) -> None:
        done = [m for m in week if m.settled]
        if not done:
            return
        for m in done:
            btts = m.hg > 0 and m.ag > 0
            self.games[m.home].append(
                TG(m.hg > m.ag, m.hg == m.ag, btts, float(m.hg > m.ag) - m.fair["1"]))
            self.games[m.away].append(
                TG(m.ag > m.hg, m.hg == m.ag, btts, float(m.ag > m.hg) - m.fair["2"]))
        self.week_goals.append(sum(m.hg + m.ag for m in done) / len(done))


Selector = Callable[[State, Match], "str | None"]


@dataclass(frozen=True)
class Candidate:
    name: str
    family: str
    fn: Selector


def _won_last(st: State, team: str, k: int) -> bool:
    g = st.games[team]
    return len(g) >= k and all(x.win for x in g[-k:])


def _no_draw_last(st: State, team: str, k: int) -> bool:
    g = st.games[team]
    return len(g) >= k and not any(x.draw for x in g[-k:])


def _mean_resid(st: State, team: str, window: int) -> float | None:
    g = st.games[team]
    if len(g) < window:
        return None
    return sum(x.resid for x in g[-window:]) / window


def win_streak(k: int, follow: bool) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        h, a = _won_last(st, m.home, k), _won_last(st, m.away, k)
        if h == a:
            return None
        return ("1" if h else "2") if follow else ("2" if h else "1")
    return Candidate(f"win_streak{k}_{'follow' if follow else 'fade'}", "streak", fn)


def draw_drought(k: int) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        return "X" if _no_draw_last(st, m.home, k) and _no_draw_last(st, m.away, k) else None
    return Candidate(f"draw_drought{k}", "drought", fn)


def goals_regime(thr: float, momentum: bool) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        w = st.week_goals
        if len(w) < 11 or "O25" not in m.fair:
            return None
        dev = w[-1] - sum(w[-11:-1]) / 10
        if abs(dev) < thr:
            return None
        over = (dev > 0) == momentum
        return "O25" if over else "U25"
    return Candidate(f"goals_{'momentum' if momentum else 'revert'}_{thr}", "goals_regime", fn)


def odds_bucket(market: str, lo: float, hi: float) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        o = m.odds.get(market)
        return market if o is not None and lo <= o < hi else None
    hi_s = "inf" if hi > 1e6 else f"{hi:g}"
    return Candidate(f"bucket_{market}_{lo:g}-{hi_s}", "odds_bucket", fn)


def team_bias(window: int, delta: float, back_underrated: bool) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        rh, ra = _mean_resid(st, m.home, window), _mean_resid(st, m.away, window)
        c: list[tuple[float, str]] = []
        if back_underrated:
            if rh is not None and rh >= delta:
                c.append((rh, "1"))
            if ra is not None and ra >= delta:
                c.append((ra, "2"))
        else:
            if rh is not None and rh <= -delta:
                c.append((-rh, "2"))
            if ra is not None and ra <= -delta:
                c.append((-ra, "1"))
        return max(c)[1] if c else None
    mode = "underrated" if back_underrated else "vs_overrated"
    return Candidate(f"team_bias_w{window}_d{delta}_{mode}", "team_bias", fn)


def btts_last(follow: bool) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        gh, ga = st.games[m.home], st.games[m.away]
        if not gh or not ga or "BY" not in m.fair:
            return None
        if gh[-1].btts and ga[-1].btts:
            return "BY" if follow else "BN"
        return None
    return Candidate(f"btts_last_{'follow' if follow else 'fade'}", "btts_last", fn)


def slot_market(slot: int, market: str) -> Candidate:
    def fn(st: State, m: Match) -> str | None:
        return market if m.slot == slot and market in m.fair else None
    return Candidate(f"slot{slot}_{market}", "slot", fn)


def build_candidates(n_slots: int) -> list[Candidate]:
    cands: list[Candidate] = []
    for k in (2, 3, 4):
        cands += [win_streak(k, True), win_streak(k, False), draw_drought(k)]
    for thr in (0.4, 0.7):
        cands += [goals_regime(thr, True), goals_regime(thr, False)]
    edges = [(1.0, 1.5), (1.5, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 10.0), (10.0, 1e9)]
    for mk in ("1", "X", "2"):
        cands += [odds_bucket(mk, lo, hi) for lo, hi in edges]
    for window in (15, 25):
        for delta in (0.12, 0.20):
            cands += [team_bias(window, delta, True), team_bias(window, delta, False)]
    cands += [btts_last(True), btts_last(False)]
    for s in range(n_slots):
        cands += [slot_market(s, mk) for mk in ("1", "X", "2", "O25", "BY")]
    return cands
