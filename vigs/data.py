"""Match model, CSV loading, settlement, de-vigging and a synthetic generator."""
from __future__ import annotations

import csv
import math
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping

from .odds import devig

# Market keys: 1 X 2, BY/BN (both teams score yes/no), and over/under lines
# such as O15, U25, FH_O05 (first half). Column name = "odds_" + key.lower(),
# except odds_btts_y / odds_btts_n.
_SPECIAL = {"odds_1": "1", "odds_x": "X", "odds_2": "2",
            "odds_btts_y": "BY", "odds_btts_n": "BN"}
_OU = re.compile(r"^(FH_)?([OU])(\d)(\d)$")
_OU_COL = re.compile(r"^odds_(fh_)?([ou])(\d)(\d)$")


def market_from_column(col: str) -> str | None:
    if col in _SPECIAL:
        return _SPECIAL[col]
    m = _OU_COL.match(col)
    if not m:
        return None
    return f"{'FH_' if m.group(1) else ''}{m.group(2).upper()}{m.group(3)}{m.group(4)}"


def column_for(market: str) -> str:
    for col, mk in _SPECIAL.items():
        if mk == market:
            return col
    return "odds_" + market.lower()


def market_label(market: str) -> str:
    names = {"1": "Home win", "X": "Draw", "2": "Away win",
                    "BY": "Both teams score", "BN": "Not both teams score"}
    if market in names:
        return names[market]
    m = _OU.match(market)
    if not m:
        return market
    side = "over" if m.group(2) == "O" else "under"
    text = f"{side} {m.group(3)}.{m.group(4)}"
    return ("First half " + text) if m.group(1) else text.capitalize()


def market_groups(markets: Iterable[str]) -> list[tuple[str, ...]]:
    """Groups of markets that partition the outcome space."""
    ms = set(markets)
    groups: list[tuple[str, ...]] = []
    if {"1", "X", "2"} <= ms:
        groups.append(("1", "X", "2"))
    if {"BY", "BN"} <= ms:
        groups.append(("BY", "BN"))
    for mk in sorted(ms):
        m = _OU.match(mk)
        if m and m.group(2) == "O":
            under = f"{m.group(1) or ''}U{m.group(3)}{m.group(4)}"
            if under in ms:
                groups.append((mk, under))
    return groups


def settle(market: str, hg: int, ag: int,
           ht_hg: int | None = None, ht_ag: int | None = None) -> bool | None:
    """True/False once decided; None when the data can't settle it (e.g. a
    first-half market without a half-time score)."""
    if market == "1":
        return hg > ag
    if market == "X":
        return hg == ag
    if market == "2":
        return hg < ag
    if market == "BY":
        return hg > 0 and ag > 0
    if market == "BN":
        return hg == 0 or ag == 0
    m = _OU.match(market)
    if not m:
        raise ValueError(f"unknown market {market!r}")
    line = int(m.group(3)) + int(m.group(4)) / 10
    if m.group(1):
        if ht_hg is None or ht_ag is None:
            return None
        goals = ht_hg + ht_ag
    else:
        goals = hg + ag
    return goals > line if m.group(2) == "O" else goals < line


def fair_probs(odds: Mapping[str, float], method: str = "proportional") -> dict[str, float]:
    """De-vigged probabilities, only for complete market groups."""
    out: dict[str, float] = {}
    for group in market_groups(odds):
        out.update(zip(group, devig([odds[m] for m in group], method)))
    return out


@dataclass(eq=False)
class Match:
    t: int                      # global round index (chronological, 0-based)
    season: str
    week: int
    slot: int                   # position within the round
    home: str
    away: str
    odds: Mapping[str, float]
    hg: int | None = None
    ag: int | None = None
    ht_hg: int | None = None
    ht_ag: int | None = None
    league: str = ""
    kickoff: datetime | None = None   # UTC
    devig_method: str = "proportional"
    fair: dict[str, float] = field(init=False)

    def __post_init__(self) -> None:
        self.fair = fair_probs(self.odds, self.devig_method)

    @property
    def settled(self) -> bool:
        return self.hg is not None and self.ag is not None

    def outcome(self, market: str) -> bool | None:
        if not self.settled:
            return None
        return settle(market, self.hg, self.ag, self.ht_hg, self.ht_ag)

    def label(self) -> str:
        return f"{self.home}-{self.away}"

    def key(self) -> str:
        return f"{self.league}|{self.season}|{self.week}|{self.home}|{self.away}"


def settle_match(market: str, m: Match) -> bool | None:
    return m.outcome(market)


def group_weeks(matches: Iterable[Match]) -> list[list[Match]]:
    weeks: dict[int, list[Match]] = {}
    for m in matches:
        weeks.setdefault(m.t, []).append(m)
    return [weeks[t] for t in sorted(weeks)]


def _int(row: dict, col: str, path: str, i: int) -> int | None:
    if not row.get(col):
        return None
    try:
        return int(row[col])
    except ValueError:
        raise ValueError(f"{path} row {i}: bad {col}={row[col]!r}") from None


def _kickoff(s: str, path: str, i: int) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{path} row {i}: bad kickoff={s!r} (use ISO 8601)") from None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def load_csv(path: str, start_t: int = 0, devig_method: str = "proportional") -> list[Match]:
    """Load matches from a chronological CSV.

    Required: week, home, away, odds_1, odds_x, odds_2.
    Optional: league, season, kickoff (ISO 8601, UTC if no offset), hg, ag,
    ht_hg, ht_ag, odds_btts_y, odds_btts_n and over/under lines such as
    odds_o15, odds_u15, odds_fh_o05, odds_fh_u05. Rows without hg/ag are upcoming.
    A new (league, season, week) starts a new round."""
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
        odds_cols = {c: market_from_column(c) for c in reader.fieldnames if c.startswith("odds_")}
        unknown = [c for c, mk in odds_cols.items() if mk is None]
        if unknown:
            raise ValueError(f"{path}: unrecognised odds columns {unknown}")
        for i, row in enumerate(reader, start=2):
            row = {k: (v or "").strip() for k, v in row.items() if k}
            league = row.get("league", "")
            season = row.get("season", "") or "s1"
            key = (league, season, row["week"])
            if key != last_key:
                t += 1
                slot = 0
                last_key = key
            odds: dict[str, float] = {}
            for col, market in odds_cols.items():
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
            hg, ag = _int(row, "hg", path, i), _int(row, "ag", path, i)
            ht_hg, ht_ag = _int(row, "ht_hg", path, i), _int(row, "ht_ag", path, i)
            if (hg is None) != (ag is None) or (ht_hg is None) != (ht_ag is None):
                raise ValueError(f"{path} row {i}: scores must have both sides set or both empty")
            wk = _int(row, "week", path, i)
            matches.append(Match(t, season, wk, slot, row["home"], row["away"], odds, hg, ag,
                                 ht_hg, ht_ag, league, _kickoff(row.get("kickoff", ""), path, i),
                                 devig_method))
            slot += 1
    if not matches:
        raise ValueError(f"{path}: no rows")
    return matches


def write_csv(path: str, matches: Iterable[Match]) -> None:
    matches = list(matches)
    markets = sorted({mk for m in matches for mk in m.odds}, key=_market_order)
    cols = ["league", "season", "week", "kickoff", "home", "away", "hg", "ag", "ht_hg", "ht_ag"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols + [column_for(mk) for mk in markets])
        for m in matches:
            vals = [m.league, m.season, m.week,
                    m.kickoff.isoformat().replace("+00:00", "Z") if m.kickoff else "",
                    m.home, m.away, m.hg, m.ag, m.ht_hg, m.ht_ag]
            w.writerow(["" if v is None else v for v in vals]
                       + [m.odds.get(mk, "") for mk in markets])


def _market_order(mk: str) -> tuple:
    head = {"1": 0, "X": 1, "2": 2, "BY": 3, "BN": 4}
    return (head.get(mk, 5), mk.startswith("FH_"), mk[-2:], mk)


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


FIRST_HALF_SHARE = 0.45
LINES = ("05", "15", "25", "35")


def _model_probs(lh: float, la: float) -> dict[str, float]:
    out: dict[str, float] = {}
    for prefix, share in (("", 1.0), ("FH_", FIRST_HALF_SHARE)):
        ph, pa = _pmf(lh * share), _pmf(la * share)
        for i, a in enumerate(ph):
            for j, b in enumerate(pa):
                w = a * b
                if not prefix:
                    k = "1" if i > j else "X" if i == j else "2"
                    out[k] = out.get(k, 0.0) + w
                    k = "BY" if i and j else "BN"
                    out[k] = out.get(k, 0.0) + w
                for ln in LINES:
                    side = "O" if i + j > int(ln) / 10 else "U"
                    k = f"{prefix}{side}{ln}"
                    out[k] = out.get(k, 0.0) + w
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


SYNTH_MARKETS = ("1", "X", "2", "BY", "BN", "O15", "U15", "O25", "U25", "O35", "U35",
                 "FH_O05", "FH_U05", "FH_O15", "FH_U15")


def synthesize(weeks: int = 60, n_teams: int = 20, seed: int = 1, margin: float = 0.06,
               hidden: Mapping[str, float] | None = None, played: int | None = None,
               skew: Mapping[str, float] | None = None, league: str = "England",
               minutes_per_round: float = 5.0,
               start: datetime = datetime(2026, 9, 1, tzinfo=timezone.utc)) -> list[Match]:
    """RNG league whose posted odds come from the true model plus a margin.

    Test hooks, never real data:
    - `hidden`: team -> log-attack boost the odds do NOT reflect.
    - `skew`: market -> multiplier on the posted odds (a mispriced market).
    - `played`: rounds after this many are left unsettled (upcoming fixtures)."""
    rng = random.Random(seed)
    teams = [f"T{i:02d}" for i in range(n_teams)]
    att = {t: rng.gauss(0, 0.15) for t in teams}
    dfn = {t: rng.gauss(0, 0.15) for t in teams}
    hidden = hidden or {}
    skew = skew or {}
    fixtures = _round_robin(teams)
    season_len = len(fixtures)
    out: list[Match] = []
    for w in range(weeks):
        rnd = fixtures[w % season_len]
        season = f"s{w // season_len + 1}"
        kickoff = start + timedelta(minutes=minutes_per_round * w)
        for slot, (h, a) in enumerate(rnd):
            lh = 1.45 * math.exp(att[h] - dfn[a] + 0.12)
            la = 1.45 * math.exp(att[a] - dfn[h] - 0.12)
            q = _model_probs(lh, la)
            odds = {}
            for mk in SYNTH_MARKETS:
                odds[mk] = max(1.01, round(skew.get(mk, 1.0) / (q[mk] * (1 + margin)), 2))
            hg = ag = hth = hta = None
            if played is None or w < played:
                bh, ba = math.exp(hidden.get(h, 0.0)), math.exp(hidden.get(a, 0.0))
                hth = _poisson(rng, lh * bh * FIRST_HALF_SHARE)
                hta = _poisson(rng, la * ba * FIRST_HALF_SHARE)
                hg = hth + _poisson(rng, lh * bh * (1 - FIRST_HALF_SHARE))
                ag = hta + _poisson(rng, la * ba * (1 - FIRST_HALF_SHARE))
            out.append(Match(w, season, w % season_len + 1, slot, h, a, odds, hg, ag,
                             hth, hta, league, kickoff))
    return out
