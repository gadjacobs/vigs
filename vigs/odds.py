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
