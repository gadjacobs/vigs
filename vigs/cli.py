"""Command line: synth | mine | walkforward | forecast | power."""
from __future__ import annotations

import argparse
import math
import sys

from . import backtest as bt
from .data import group_weeks, load_csv, synthesize, write_csv
from .patterns import build_candidates
from .stats import required_n


def _load(path: str):
    matches = load_csv(path)
    settled = [m for m in matches if m.settled]
    if not settled:
        sys.exit(f"{path}: no settled matches (hg/ag missing)")
    n_weeks = max(m.t for m in settled) + 1
    n_slots = max(m.slot for m in matches) + 1
    return matches, n_weeks, n_slots


def _fmt(s: bt.Stats) -> str:
    return (f"n={s.n:<4d} hit={s.hit_rate:5.1%} odds={s.mean_odds:4.2f} "
            f"roi={s.roi:+6.1%} z={s.z:+5.2f}")


def cmd_synth(a) -> None:
    hidden = {f"T{i:02d}": 0.35 for i in range(a.plant)} if a.plant else None
    ms = synthesize(a.weeks, a.teams, a.seed, a.margin, hidden, a.played)
    write_csv(a.out, ms)
    print(f"wrote {len(ms)} SYNTHETIC matches ({a.weeks} weeks) to {a.out}"
          + (f", planted edge on {a.plant} team(s)" if a.plant else ", no planted edge"))


def cmd_mine(a) -> None:
    matches, n_weeks, n_slots = _load(a.csv)
    cands = build_candidates(n_slots)
    bets = bt.build_bets(matches, cands)
    rows, k, split_t = bt.mine(bets, n_weeks, a.split, a.top)
    print(f"{sum(m.settled for m in matches)} matches, {n_weeks} gameweeks, "
          f"{len(cands)} candidate patterns ({k} with enough bets). "
          f"Train: weeks 1-{split_t}, holdout: {split_t + 1}-{n_weeks}.")
    print("z = hits vs the de-vigged market (z>0: pattern wins more than odds imply). "
          "roi includes the bookmaker margin.\n")
    for i, r in enumerate(rows, 1):
        print(f"#{i} {r.name}  [{r.verdict}]")
        print(f"   train   {_fmt(r.train)}  FDR q={r.bh_q:.2f}")
        ci = r.test.ci
        print(f"   holdout {_fmt(r.test)}  adj p={r.test_p_adj:.2f}"
              + (f"  roi 95% CI [{ci[0]:+.0%}, {ci[1]:+.0%}]" if ci else ""))
    if not rows:
        print("No candidate had enough bets; need more gameweeks.")
    elif not any(r.verdict != "no evidence" for r in rows):
        print(f"\nNothing survives. With {k} patterns tested, the best-looking one is "
              "expected to look good by chance alone.")


def cmd_walk(a) -> None:
    matches, n_weeks, n_slots = _load(a.csv)
    cands = build_candidates(n_slots)
    bets = bt.build_bets(matches, cands)
    min_z = -1e9 if a.force else a.min_z
    res = bt.walk_forward(bets, n_weeks, a.warmup, a.top, a.lo, a.hi, a.max_accas, min_z=min_z)
    s = bt.summarize_walk(res, matches, a.lo, a.hi)
    print(f"Walk-forward, weeks {a.warmup + 1}-{n_weeks}; patterns re-selected each week "
          f"from past data only; accas in the {a.lo:g}-{a.hi:g} band.")
    if s.n == 0:
        print("No accumulator could be built (no pattern passed the evidence filter, or "
              "too few picks per week). Try --force or --min-z 0.")
        return
    print(f"  accas built      {s.n}  (mean odds {s.mean_odds:.1f})")
    print(f"  hits             {s.hits}  (market-fair expectation {s.expected_hits:.2f}, "
          f"P(>= hits) = {s.p_vs_fair:.2f})")
    print(f"  ROI              {s.roi:+.0%}   random-acca baseline {s.baseline_mean_roi:+.0%} "
          f"(strategy beat {s.baseline_pct:.0%} of random runs)")
    p0 = 1 / s.mean_odds
    print(f"  Reality check: confirming even a +10% ROI at odds ~{s.mean_odds:.0f} needs about "
          f"{required_n(p0, 1.1 * p0):,} accas; this test has {s.n}. "
          "Judge patterns at leg level (`mine`), not by acca results.")


def cmd_forecast(a) -> None:
    hist, n_weeks, n_slots = _load(a.history)
    nxt = load_csv(a.upcoming, start_t=n_weeks)
    cands = build_candidates(n_slots)
    bets = bt.build_bets(hist + nxt, cands)
    cum = {name: bt._Cum() for name in bets}
    for name, bs in bets.items():
        for b in bs:
            if b.hit is not None:
                cum[name].add(b)
    chosen = bt.select_patterns(cum, a.top, 20, -1e9 if a.force else a.min_z)
    print("Patterns used (evidence from all history):")
    if not chosen:
        print("  none passed the evidence filter (try --force to see what the best look like)")
        return
    for name, z in chosen:
        print(f"  {name:<34s} {_fmt(bt.evaluate(bets[name]))}")
    weeks = group_weeks(nxt)[: a.horizon]
    for wk in weeks:
        t = wk[0].t
        picks = [(b, z) for name, z in chosen for b in bets[name] if b.t == t]
        accas = bt.build_accas(picks, a.lo, a.hi, a.max_accas)
        print(f"\nGameweek {wk[0].week} ({len(picks)} pattern picks)")
        if not accas:
            print("  no combination of picks lands in the odds band")
        for i, combo in enumerate(accas, 1):
            odds = math.prod(b.odds for b in combo)
            fair = math.prod(b.q for b in combo)
            print(f"  acca {i}: odds {odds:.1f}, market-implied hit chance {fair:.1%}")
            for b in combo:
                print(f"     {b.match.label():<12s} {b.market:<4s} @ {b.odds:.2f}  ({b.cand})")
    print("\nNote: signals for weeks after the first upcoming one use results only up to the "
          "last settled week. Hit chance shown is what the odds imply, not a promise.")


def cmd_power(a) -> None:
    p0 = 1 / a.odds
    p1 = (1 + a.roi) * p0
    n = required_n(p0, p1)
    print(f"At odds {a.odds:g}, break-even win rate is {p0:.2%}. To show a true ROI of "
          f"{a.roi:+.0%} (win rate {p1:.2%}) with 80% power at 5% significance you need "
          f"about {n:,} bets.")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="vigs", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("synth", help="generate SYNTHETIC data to test the pipeline")
    p.add_argument("--out", default="synthetic.csv")
    p.add_argument("--weeks", type=int, default=60)
    p.add_argument("--teams", type=int, default=20)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--margin", type=float, default=0.06)
    p.add_argument("--plant", type=int, default=0, help="give N teams an edge the odds omit")
    p.add_argument("--played", type=int, default=None, help="leave later weeks unsettled")
    p.set_defaults(fn=cmd_synth)

    p = sub.add_parser("mine", help="rank patterns, validate on a holdout")
    p.add_argument("csv")
    p.add_argument("--split", type=float, default=0.7)
    p.add_argument("--top", type=int, default=5)
    p.set_defaults(fn=cmd_mine)

    p = sub.add_parser("walkforward", help="simulate accas week by week")
    p.add_argument("csv")
    p.add_argument("--warmup", type=int, default=25)
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--lo", type=float, default=20)
    p.add_argument("--hi", type=float, default=50)
    p.add_argument("--max-accas", dest="max_accas", type=int, default=3)
    p.add_argument("--min-z", dest="min_z", type=float, default=1.0)
    p.add_argument("--force", action="store_true", help="ignore the evidence filter")
    p.set_defaults(fn=cmd_walk)

    p = sub.add_parser("forecast", help="picks and accas for upcoming gameweeks")
    p.add_argument("history")
    p.add_argument("upcoming")
    p.add_argument("--horizon", type=int, default=2)
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--lo", type=float, default=20)
    p.add_argument("--hi", type=float, default=50)
    p.add_argument("--max-accas", dest="max_accas", type=int, default=3)
    p.add_argument("--min-z", dest="min_z", type=float, default=1.0)
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_forecast)

    p = sub.add_parser("power", help="how many bets prove an edge")
    p.add_argument("--odds", type=float, default=30)
    p.add_argument("--roi", type=float, default=0.10)
    p.set_defaults(fn=cmd_power)

    a = ap.parse_args(argv)
    a.fn(a)
