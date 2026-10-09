"""Sheets: a query over graded upcoming selections, as singles or an accumulator."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .evidence import GradedPick
from .grading import RANK
from .odds import house_cut

LOW_CHANCE = 0.20


@dataclass
class SheetQuery:
    markets: set[str] | None = None
    count: int = 10
    min_grade: str = "Lean"
    odds_lo: float = 1.01
    odds_hi: float = 1000.0
    max_per_round: int | None = None
    output: str = "singles"          # singles | acca


@dataclass
class Sheet:
    query: SheetQuery
    picks: list[GradedPick]
    mode: str                         # the lowest grade on the sheet
    avoid: list[GradedPick] = field(default_factory=list)
    eligible: int = 0
    note: str = ""

    @property
    def combined_odds(self) -> float:
        return math.prod(p.obs.odds for p in self.picks)

    @property
    def combined_estimate(self) -> float:
        return math.prod(p.graded.estimate for p in self.picks)

    @property
    def combined_market(self) -> float:
        return math.prod(p.obs.q for p in self.picks)

    @property
    def house_cut(self) -> float:
        return house_cut([p.obs.odds for p in self.picks], [p.obs.q for p in self.picks])


def build_sheet(graded: list[GradedPick], q: SheetQuery) -> Sheet:
    floor = RANK[q.min_grade]
    in_scope = [g for g in graded
                if (q.markets is None or g.obs.market in q.markets)
                and q.odds_lo <= g.obs.odds <= q.odds_hi]
    avoid = [g for g in in_scope if g.graded.grade == "Avoid"]
    ok = [g for g in in_scope if RANK[g.graded.grade] >= max(floor, RANK["Rough"])]
    rough = q.min_grade == "Rough"
    # Rough sheets rank by history (likelihood); others by edge.
    ok.sort(key=lambda g: (-RANK[g.graded.grade],
                           -(g.graded.estimate if rough else g.graded.edge)))
    chosen: list[GradedPick] = []
    fixtures: set[int] = set()
    per_round: dict[int, int] = {}
    for g in ok:
        m = g.obs.match
        if id(m) in fixtures:
            continue
        if q.max_per_round and per_round.get(m.t, 0) >= q.max_per_round:
            continue
        chosen.append(g)
        fixtures.add(id(m))
        per_round[m.t] = per_round.get(m.t, 0) + 1
        if len(chosen) >= q.count:
            break
    mode = min((g.graded.grade for g in chosen), key=RANK.get, default=q.min_grade)
    note = ""
    if not chosen:
        note = (f"Nothing clears the {q.min_grade} bar in this window. "
                + ("Show Lean picks, or build a Rough sheet." if q.min_grade == "Solid" else
                   "Build a Rough sheet." if q.min_grade == "Lean" else
                   "Widen the odds range or the markets."))
    elif len(chosen) < q.count:
        note = (f"Only {len(chosen)} of {q.count} selections reach {q.min_grade} or better. "
                "The bar was not lowered to fill the sheet.")
    return Sheet(q, chosen, mode, avoid, len(ok), note)
