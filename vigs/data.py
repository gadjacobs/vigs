"""Match model, CSV loading, settlement, de-vigging and a synthetic generator."""
from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass, field
from typing import Iterable, Mapping

MARKETS = ("1", "X", "2", "O25", "U25", "BY", "BN")
# Markets that partition the outcome space; de-vigging needs the whole group.
GROUPS = (("1", "X", "2"), ("O25", "U25"), ("BY", "BN"))
COLUMN = {
    "1": "odds_1", "X": "odds_x", "2": "odds_2",
    "O25": "odds_o25", "U25": "odds_u25",
    "BY": "odds_btts_y", "BN": "odds_btts_n",
}


def settle(market: str, hg: int, ag: int) -> bool:
    return {
        "1": hg > ag, "X": hg == ag, "2": hg < ag,
        "O25": hg + ag >= 3, "U25": hg + ag <= 2,
        "BY": hg > 0 and ag > 0, "BN": hg == 0 or ag == 0,
    }[market]


def fair_probs(odds: Mapping[str, float]) -> dict[str, float]:
    """Proportionally de-vigged probabilities, only for complete market groups."""
    out: dict[str, float] = {}
    for group in GROUPS:
        if all(m in odds for m in group):
            inv = [1.0 / odds[m] for m in group]
            tot = sum(inv)
            out.update({m: i / tot for m, i in zip(group, inv)})
    return out


@dataclass(eq=False)
class Match:
    t: int                      # global gameweek index (chronological, 0-based)
    season: str
    week: int
    slot: int                   # position within the gameweek
    home: str
    away: str
    odds: Mapping[str, float]
    hg: int | None = None
    ag: int | None = None
    fair: dict[str, float] = field(init=False)

    def __post_init__(self) -> None:
        self.fair = fair_probs(self.odds)

    @property
    def settled(self) -> bool:
        return self.hg is not None and self.ag is not None

    def label(self) -> str:
        return f"{self.home}-{self.away}"


def group_weeks(matches: Iterable[Match]) -> list[list[Match]]:
    weeks: dict[int, list[Match]] = {}
    for m in matches:
        weeks.setdefault(m.t, []).append(m)
    return [weeks[t] for t in sorted(weeks)]


def load_csv(path: str, start_t: int = 0) -> list[Match]:
    """Load matches. File must be chronological. Required columns: week, home,
    away, odds_1, odds_x, odds_2. Optional: season, hg, ag, odds_o25, odds_u25,
    odds_btts_y, odds_btts_n. Rows without hg/ag are treated as upcoming."""
    matches: list[Match] = []
    t = start_t - 1
    last_key = None
    slot = 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise ValueError(f"{path}: empty file")
        reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]
        need = {"week", "home", "away", "odds_1", "odds_x", "odds_2"}
        missing = need - set(reader.fieldnames)
        if missing:
            raise ValueError(f"{path}: missing columns {sorted(missing)}")
        for i, row in enumerate(reader, start=2):
            row = {k: (v or "").strip() for k, v in row.items() if k}
            season = row.get("season", "") or "s1"
            key = (season, row["week"])
            if key != last_key:
                t += 1
                slot = 0
                last_key = key
            odds: dict[str, float] = {}
            for market, col in COLUMN.items():
                if row.get(col):
                    try:
                        o = float(row[col])
                    except ValueError:
                        raise ValueError(f"{path} row {i}: bad {col}={row[col]!r}") from None
                    if o <= 1.0:
                        raise ValueError(f"{path} row {i}: {col} must be > 1.0")
                    odds[market] = o
            if not {"1", "X", "2"} <= odds.keys():
                raise ValueError(f"{path} row {i}: 1X2 odds are required")
            hg = int(row["hg"]) if row.get("hg") else None
            ag = int(row["ag"]) if row.get("ag") else None
            if (hg is None) != (ag is None):
                raise ValueError(f"{path} row {i}: hg and ag must both be set or both empty")
            try:
                wk = int(row["week"])
            except ValueError:
                raise ValueError(f"{path} row {i}: bad week={row['week']!r}") from None
            matches.append(Match(t, season, wk, slot, row["home"], row["away"], odds, hg, ag))
            slot += 1
    if not matches:
        raise ValueError(f"{path}: no rows")
    return matches


def write_csv(path: str, matches: Iterable[Match]) -> None:
    cols = ["season", "week", "home", "away", "hg", "ag"] + list(COLUMN.values())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for m in matches:
            w.writerow([m.season, m.week, m.home, m.away,
                        "" if m.hg is None else m.hg, "" if m.ag is None else m.ag]
                       + [m.odds.get(k, "") for k in COLUMN])


# ---------------------------------------------------------------- synthetic --

def _poisson(rng: random.Random, lam: float) -> int:
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _pmf(lam: float, kmax: int = 10) -> list[float]:
    p = [math.exp(-lam)]
    for k in range(1, kmax + 1):
        p.append(p[-1] * lam / k)
    return p


def _model_probs(lh: float, la: float) -> dict[str, float]:
    ph, pa = _pmf(lh), _pmf(la)
    out = dict.fromkeys(MARKETS, 0.0)
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            w = a * b
            out["1" if i > j else "X" if i == j else "2"] += w
            out["O25" if i + j >= 3 else "U25"] += w
            out["BY" if i and j else "BN"] += w
    return out


def _round_robin(teams: list[str]) -> list[list[tuple[str, str]]]:
    n = len(teams)
    rot = teams[:]
    rounds = []
    for r in range(n - 1):
        pairs = [(rot[i], rot[n - 1 - i]) for i in range(n // 2)]
        rounds.append([(a, b) if (r + i) % 2 == 0 else (b, a) for i, (a, b) in enumerate(pairs)])
        rot = [rot[0]] + [rot[-1]] + rot[1:-1]
    return rounds + [[(b, a) for a, b in rd] for rd in rounds]


def synthesize(weeks: int = 60, n_teams: int = 20, seed: int = 1, margin: float = 0.06,
               hidden: Mapping[str, float] | None = None, played: int | None = None) -> list[Match]:
    """RNG league whose posted odds come from the true model plus a margin.
    `hidden` maps team -> log-attack boost the odds do NOT reflect (a planted
    edge used only to verify the miner can find something real).
    `played` leaves matches after that many weeks unsettled (upcoming fixtures)."""
    rng = random.Random(seed)
    teams = [f"T{i:02d}" for i in range(n_teams)]
    att = {t: rng.gauss(0, 0.15) for t in teams}
    dfn = {t: rng.gauss(0, 0.15) for t in teams}
    hidden = hidden or {}
    fixtures = _round_robin(teams)
    out: list[Match] = []
    for w in range(weeks):
        rnd = fixtures[w % len(fixtures)]
        for slot, (h, a) in enumerate(rnd):
            lh = 1.45 * math.exp(att[h] - dfn[a] + 0.12)
            la = 1.45 * math.exp(att[a] - dfn[h] - 0.12)
            q = _model_probs(lh, la)
            odds = {}
            for group in GROUPS:
                for mk in group:
                    odds[mk] = max(1.01, round(1.0 / (q[mk] * (1 + margin)), 2))
            is_played = played is None or w < played
            hg = ag = None
            if is_played:
                hg = _poisson(rng, lh * math.exp(hidden.get(h, 0.0)))
                ag = _poisson(rng, la * math.exp(hidden.get(a, 0.0)))
            out.append(Match(w, "s1", w + 1, slot, h, a, odds, hg, ag))
    return out
