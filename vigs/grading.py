"""Shrinkage estimates and grades.

Vig estimate: the history rate shrunk toward the market chance by a Beta prior
of strength k. Small samples barely move it; large, consistent samples do.

Grades (exactly one per selection):
  Solid  P(true rate > break-even) >= 90%, n >= 300, edge held walk-forward,
         survives the false-discovery check, and enough data collected.
  Lean   estimate above break-even with P >= 80%, but misses a Solid test.
  Rough  no evidence it beats break-even ("likely, and priced for it").
  Avoid  history below break-even and P(true rate > break-even) < 5%.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .stats import beta_ppf, betainc

GRADES = ("Avoid", "Rough", "Lean", "Solid")
RANK = {g: i for i, g in enumerate(GRADES)}


@dataclass(frozen=True)
class GradeConfig:
    k: float = 200.0            # prior strength, in pseudo-matches
    solid_p: float = 0.90
    lean_p: float = 0.80
    avoid_p: float = 0.05
    min_n: int = 300
    min_days: float = 30.0


@dataclass
class Test:
    name: str
    passed: bool
    detail: str


@dataclass
class Graded:
    grade: str
    odds: float
    break_even: float
    market_prob: float
    history_rate: float | None
    n: int
    estimate: float
    p_beats: float
    edge: float
    tests: list[Test] = field(default_factory=list)
    _a: float = 0.0
    _b: float = 0.0
    ci: tuple[float, float] | None = None       # set when the estimate is model-based

    def interval(self, level: float = 0.90) -> tuple[float, float]:
        if self.ci is not None:
            return self.ci
        tail = (1 - level) / 2
        return beta_ppf(tail, self._a, self._b), beta_ppf(1 - tail, self._a, self._b)

    @property
    def missed(self) -> list[str]:
        return [t.name for t in self.tests if not t.passed]

    def why(self) -> str:
        if self.grade == "Avoid":
            return "history sits below break-even"
        if self.grade == "Solid":
            return "passes every test"
        if self.grade == "Lean":
            return "evidence points above break-even; missed: " + ", ".join(self.missed)
        return "likely, and priced for it: no evidence it beats break-even"


def posterior(hits: int, n: int, prior_mean: float, k: float) -> tuple[float, float]:
    prior_mean = min(max(prior_mean, 1e-4), 1 - 1e-4)
    return k * prior_mean + hits, k * (1 - prior_mean) + (n - hits)


def grade(odds: float, market_prob: float, n: int, hits: int,
          prior_mean: float | None = None, validated: bool | None = None,
          fdr_pass: bool | None = None, collected_days: float | None = None,
          cfg: GradeConfig = GradeConfig()) -> Graded:
    be = 1.0 / odds
    a, b = posterior(hits, n, market_prob if prior_mean is None else prior_mean, cfg.k)
    est = a / (a + b)
    p_beats = 1.0 - betainc(a, b, be)
    rate = hits / n if n else None
    tests = [
        Test("beats break-even", p_beats >= cfg.solid_p,
             f"P(true rate > {be:.1%}) = {p_beats:.0%}, needs {cfg.solid_p:.0%}"),
        Test("sample size", n >= cfg.min_n, f"n = {n}, needs {cfg.min_n}"),
        Test("walk-forward", bool(validated),
             "edge held on unseen data" if validated else
             ("not tested" if validated is None else "edge not proven on unseen data")),
        Test("false discovery", bool(fdr_pass),
             "survives Benjamini-Hochberg at 10%" if fdr_pass else
             ("not tested" if fdr_pass is None else "could be luck across all slices tested")),
        Test("data collected", collected_days is not None and collected_days >= cfg.min_days,
             f"{collected_days:.1f} days, needs {cfg.min_days:g}" if collected_days is not None
             else "collection span unknown (no kickoff times)"),
    ]
    if rate is not None and rate < be and p_beats < cfg.avoid_p:
        g = "Avoid"
    elif all(t.passed for t in tests):
        g = "Solid"
    elif est > be and p_beats >= cfg.lean_p:
        g = "Lean"
    else:
        g = "Rough"
    return Graded(g, odds, be, market_prob, rate, n, est, p_beats, est * odds - 1.0, tests, a, b)


def grade_model(odds: float, market_prob: float, estimate: float, ci: tuple[float, float],
                history_rate: float | None, history_n: int) -> Graded:
    """Grade a results-model estimate before any odds history exists. Without
    walk-forward validation on settled odds it can never be Solid."""
    be = 1.0 / odds
    lo, hi = ci
    tests = [
        Test("beats break-even", lo > be,
             f"90% interval [{lo:.1%}, {hi:.1%}] vs break-even {be:.1%}"),
        Test("walk-forward", False, "not tested: odds history is still being collected"),
        Test("false discovery", False, "not tested: no odds history yet"),
        Test("data collected", False, "odds collection started 2026-10-09"),
    ]
    g = "Avoid" if hi < be else "Lean" if lo > be else "Rough"
    return Graded(g, odds, be, market_prob, history_rate, history_n, estimate,
                  1.0 if lo > be else 0.0, estimate * odds - 1.0, tests, ci=ci)
