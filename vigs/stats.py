"""Small, dependency-free statistics helpers."""
from __future__ import annotations

import math
import random
from statistics import NormalDist

_N = NormalDist()


def z_vs_fair(hits: float, qs: list[float]) -> tuple[float, float]:
    """Do selected bets win more often than the de-vigged market implies?
    Poisson-binomial z-score and one-sided p-value (normal approximation)."""
    var = sum(q * (1 - q) for q in qs)
    if var <= 0:
        return 0.0, 1.0
    z = (hits - sum(qs)) / math.sqrt(var)
    return z, 1.0 - _N.cdf(z)


def poisson_binomial_sf(k: int, ps: list[float]) -> float:
    """Exact P(X >= k) for a sum of independent Bernoulli(p_i)."""
    if k <= 0:
        return 1.0
    if k > len(ps):
        return 0.0
    dp = [1.0] + [0.0] * (k - 1)          # dp[j] = P(count == j), j < k
    for p in ps:
        for j in range(k - 1, 0, -1):
            dp[j] = dp[j] * (1 - p) + dp[j - 1] * p
        dp[0] *= 1 - p
    return max(0.0, 1.0 - sum(dp))


def bootstrap_ci(values: list[float], n_boot: int = 1000, seed: int = 0,
                 alpha: float = 0.05) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(values)
    means = sorted(sum(rng.choices(values, k=n)) / n for _ in range(n_boot))
    return means[int(n_boot * alpha / 2)], means[int(n_boot * (1 - alpha / 2)) - 1]


def bh_qvalues(pvals: list[float]) -> list[float]:
    """Benjamini-Hochberg adjusted p-values (false discovery rate)."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    q = [0.0] * m
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        prev = min(prev, pvals[i] * m / rank)
        q[i] = prev
    return q


def required_n(p0: float, p1: float, alpha: float = 0.05, power: float = 0.8) -> int:
    """Bets needed to distinguish true win prob p1 from break-even p0 (one-sided)."""
    za, zb = _N.inv_cdf(1 - alpha), _N.inv_cdf(power)
    num = za * math.sqrt(p0 * (1 - p0)) + zb * math.sqrt(p1 * (1 - p1))
    return math.ceil((num / (p1 - p0)) ** 2)


# ------------------------------------------------------------ beta / binomial

def betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b): the Beta(a, b) CDF at x."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbt = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
           + a * math.log(x) + b * math.log1p(-x))
    bt = math.exp(lbt)
    if x < (a + 1) / (a + b + 2):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def _betacf(a: float, b: float, x: float) -> float:
    tiny, eps = 1e-300, 3e-15
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 20000):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        de = d * c
        h *= de
        if abs(de - 1.0) < eps:
            break
    return h


def beta_ppf(q: float, a: float, b: float) -> float:
    """Inverse Beta CDF by bisection."""
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if betainc(a, b, mid) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def p_rate_above(hits: int, bes: list[float], exact_max: int = 400) -> float:
    """One-sided p-value for 'these bets win more often than break-even', where
    bet i breaks even at bes[i]. Exact Poisson-binomial for small n."""
    if not bes:
        return 1.0
    if len(bes) <= exact_max:
        return poisson_binomial_sf(hits, bes)
    var = sum(p * (1 - p) for p in bes)
    z = (hits - 0.5 - sum(bes)) / math.sqrt(var)    # continuity-corrected
    return 1.0 - _N.cdf(z)
