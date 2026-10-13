"""Odds maths. Decimal odds throughout."""
from __future__ import annotations

import math
from typing import Sequence


def implied(odds: float) -> float:
    return 1.0 / odds


def break_even(odds: float) -> float:
    """Hit rate a selection needs to not lose money."""
    return 1.0 / odds


def overround(odds: Sequence[float]) -> float:
    return sum(1.0 / o for o in odds) - 1.0


def edge(prob: float, odds: float) -> float:
    """Expected return per unit staked."""
    return prob * odds - 1.0


# Market chance for live odds. On 298 settled vFootball matches Shin scored
# better than proportional (log loss 0.4568 vs 0.4590 per selection), mostly on
# longshot lines such as over 4.5 and first-half over 2.5.
LIVE_DEVIG = "shin"


def devig(odds: Sequence[float], method: str = "proportional") -> list[float]:
    """Market chance with the margin removed, for a complete group of outcomes."""
    inv = [1.0 / o for o in odds]
    total = sum(inv)
    if method == "proportional" or total <= 1.0:
        return [i / total for i in inv]
    if method == "shin":
        return _shin(inv, total)
    raise ValueError(f"unknown de-vig method {method!r}")


def _shin(inv: list[float], total: float) -> list[float]:
    """Shin (1993): margin loaded more heavily onto longshots."""
    def probs(z: float) -> list[float]:
        return [(math.sqrt(z * z + 4 * (1 - z) * p * p / total) - z) / (2 * (1 - z)) for p in inv]
    lo, hi = 0.0, 0.5
    for _ in range(100):
        mid = (lo + hi) / 2
        if sum(probs(mid)) > 1.0:
            lo = mid
        else:
            hi = mid
    ps = probs((lo + hi) / 2)
    s = sum(ps)
    return [p / s for p in ps]


def combined_odds(odds: Sequence[float]) -> float:
    return math.prod(odds)


def combined_prob(probs: Sequence[float]) -> float:
    """Only valid for independent legs (different fixtures)."""
    return math.prod(probs)


def house_cut(odds: Sequence[float], probs: Sequence[float]) -> float:
    """Share of the stake the slip is expected to lose at these probabilities."""
    return 1.0 - combined_prob(probs) * combined_odds(odds)


# The likeliest slip for a payout. Market chance is calibrated on our data
# (3,678 settled matches: landed 39.6% vs 39.7% priced on total-goals overs,
# 26.9% vs 26.3% on draws), so at a given total price the chance a slip lands is
# set by how much of the stake the bookmaker keeps, compounded once per leg.
# Legs priced 1.5 to 5 keep the most per unit of odds they add: short legs
# (under 1.5) need many legs to reach a price, and long ones (over 5) carry a
# heavy margin (paid back 0.82 at 5-10 and 0.58 above 10, against 0.97 at 1.2-2).
SLIP_LEG_RANGE = (1.5, 5.0)
SLIP_STEP = 0.005    # resolution of the search, in log-odds
SLIP_SLACK = 0.10    # how far above the target the total may land, in log-odds


def _bucket(x: float) -> int:
    return math.floor(x / SLIP_STEP + 0.5)


def likeliest_slip(matches: Sequence[tuple[str, Sequence[tuple[str, float, float]]]], target: float,
                   lo: float = SLIP_LEG_RANGE[0], hi: float = SLIP_LEG_RANGE[1],
                   slack: float = SLIP_SLACK) -> list[tuple[str, str, float, float]]:
    """At most one selection per match, total odds at least about `target`, with
    the highest product of chances. `matches` is (id, [(market, odds, chance)]),
    in the order to consider them; returns (id, market, odds, chance) in that order.
    Exact over the search grid (dynamic programming over summed log-odds)."""
    if target <= 1:
        return []
    top = _bucket(math.log(target) + slack)
    need = math.floor(math.log(target) / SLIP_STEP)
    neg = float("-inf")
    best = [neg] * (top + 1)
    best[0] = 0.0
    stages = []
    for mid, options in matches:
        opts = [(m, o, p, _bucket(math.log(o)), math.log(p)) for m, o, p in options if lo <= o <= hi and 0 < p < 1]
        nxt = best[:]
        choice = [-1] * (top + 1)
        for b in range(top + 1):
            v0 = best[b]
            if v0 == neg:
                continue
            for j, (_, _, _, k, lp) in enumerate(opts):
                nb = b + k
                if nb <= top and v0 + lp > nxt[nb]:
                    nxt[nb] = v0 + lp
                    choice[nb] = j
        stages.append((mid, opts, choice))
        best = nxt
    end = max((b for b in range(need, top + 1) if best[b] > neg), key=lambda b: (best[b], -b), default=None)
    if end is None:
        return []
    out = []
    for mid, opts, choice in reversed(stages):
        j = choice[end]
        if j >= 0:
            m, o, p, k, _ = opts[j]
            out.append((mid, m, o, p))
            end -= k
    return out[::-1]
