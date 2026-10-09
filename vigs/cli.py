"""Command line: fetch | build | evidence | sheet | ledger | slip | mine | walkforward | forecast | power | synth."""
from __future__ import annotations

import argparse
import math
import sys

from . import backtest as bt
from .data import group_weeks, load_csv, market_label, synthesize, write_csv
from .evidence import STATS_VERSION, analyze, calibration, grade_obs
from .grading import GRADES, RANK, GradeConfig
from .ledger import Ledger, LedgerError, summarize
from .odds import combined_odds, combined_prob, house_cut
from .patterns import build_candidates
from .sheet import LOW_CHANCE, SheetQuery, build_sheet
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
    skew = {}
    for item in a.skew or []:
        mk, _, mult = item.partition("=")
        skew[mk.upper()] = float(mult)
    ms = synthesize(a.weeks, a.teams, a.seed, a.margin, hidden, a.played, skew, a.league,
                    a.minutes)
    write_csv(a.out, ms)
    planted = [f"edge on {a.plant} team(s)"] if a.plant else []
    planted += [f"{k} odds x{v:g}" for k, v in skew.items()]
    print(f"wrote {len(ms)} SYNTHETIC matches ({a.weeks} rounds) to {a.out}; planted: "
          + (", ".join(planted) or "nothing"))


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


def _pct(x: float | None) -> str:
    return "-" if x is None else f"{x:.1%}"


def _markets(arg: str | None) -> set[str] | None:
    return {m.strip().upper() for m in arg.split(",")} if arg else None


def _cfg(a) -> GradeConfig:
    return GradeConfig(k=a.k, min_days=a.min_days)


def cmd_evidence(a) -> None:
    matches = load_csv(a.csv, devig_method=a.devig)
    an, obs = analyze(matches, None, _cfg(a))
    wanted = _markets(a.market)
    obs = [o for o in obs if wanted is None or o.market in wanted]
    settled = [o for o in obs if o.hit is not None]
    if not settled:
        sys.exit("no settled selections to learn from")
    print(f"{an.n_settled_matches} settled matches, {len(settled)} selections shown, "
          f"{an.n_tested} slices with n >= 30 tested. Walk-forward over the last "
          f"{an.test_rounds} rounds. Contexts: {', '.join(an.dims) or 'none'}.")
    print("\nCalibration: what the market said vs what happened")
    print(f"  {'market chance':<14s}{'n':>7s}{'market':>9s}{'history':>9s}{'break-even':>12s}")
    for label, n, mq, hr, be in calibration(settled):
        print(f"  {label:<14s}{n:>7d}{mq:>9.1%}{hr:>9.1%}{be:>12.1%}")
    hits, sq, vq = an.overall
    z = (hits - sq) / math.sqrt(vq) if vq else 0.0
    if abs(z) < 2:
        print(f"  Verdict: history matches market chance (z = {z:+.1f}). Break-even sits above "
              "both, so on average the margin decides.")
    else:
        print(f"  Verdict: history departs from market chance (z = {z:+.1f}). Check the slices below.")

    rows = [(k, an.grade_slice(k)) for k, st in an.slices.items()
            if st.n >= a.min_n and (wanted is None or k.split("|")[0] in wanted)]
    counts = {g: sum(r[1].grade == g for r in rows) for g in GRADES}
    rows.sort(key=lambda r: (-RANK[r[1].grade], -r[1].p_beats))
    print(f"\nSlices with n >= {a.min_n}: " + ", ".join(f"{g} {counts[g]}" for g in reversed(GRADES)))
    print(f"Top {a.top} by grade, then P(true rate > break-even):")
    for key, g in rows[: a.top]:
        st = an.slices[key]
        lo, hi = g.interval()
        wf = st.validated(an.cfg.min_n)
        print(f"  {g.grade:<6s} {key}")
        print(f"         n {st.n}, history {_pct(g.history_rate)}, market {st.market_mean:.1%}, "
              f"break-even {g.break_even:.1%}, Vig {g.estimate:.1%} [{lo:.1%}, {hi:.1%}], "
              f"P(beat) {g.p_beats:.0%}")
        print(f"         walk-forward {'-' if wf is None else 'held' if wf else 'not proven'}"
              f" (n {st.oos_n}, ROI {st.oos_roi:+.1%}), FDR q "
              f"{'-' if st.q_fdr is None else f'{st.q_fdr:.2f}'}. {g.why()}")
    if not counts["Solid"]:
        print("\nNothing clears the Solid bar." + (
            f" Highest grade is capped at Lean until {an.cfg.min_days:g} days are collected."
            if (an.collected_days or 0) < an.cfg.min_days else ""))


def _print_pick(i: int, gp, show_slice: bool = True) -> None:
    g, o = gp.graded, gp.obs
    lo, hi = g.interval()
    print(f"  {i:>2d}. {o.match.label():<12s} {market_label(o.market):<22s} @ {o.odds:<5.2f} "
          f"{g.grade}")
    print(f"      break-even {g.break_even:.1%}, market {o.q:.1%}, history {_pct(g.history_rate)}"
          f" (n {g.n}), Vig {g.estimate:.1%} [{lo:.1%}, {hi:.1%}], edge {g.edge:+.1%} "
          f"(N{g.edge * 1000:+,.0f} per N1,000)")
    if show_slice:
        print(f"      slice {gp.slice_key} (best of {gp.slices_considered}); {g.why()}")


def cmd_sheet(a) -> None:
    hist = load_csv(a.history, devig_method=a.devig)
    n_rounds = max(m.t for m in hist) + 1
    nxt = load_csv(a.upcoming, start_t=n_rounds, devig_method=a.devig)
    if any(m.settled for m in nxt):
        sys.exit(f"{a.upcoming}: contains results; sheets are for fixtures not yet played")
    rounds = sorted({m.t for m in nxt})[: a.rounds]
    nxt = [m for m in nxt if m.t in rounds]
    # Always test every market, so the false-discovery family can't be shrunk
    # by narrowing the query; the market filter applies when the sheet is built.
    an, obs = analyze(hist + nxt, None, _cfg(a))
    wanted = _markets(a.market)
    graded = [grade_obs(o, an) for o in obs
              if o.hit is None and (wanted is None or o.market in wanted)]
    lo, _, hi = a.odds.partition("-")
    q = SheetQuery(_markets(a.market), a.count, a.min_grade.capitalize(), float(lo),
                   float(hi or 1000), a.max_per_round, a.output)
    sh = build_sheet(graded, q)
    label = ", ".join(market_label(m) for m in sorted(q.markets)) if q.markets else "all markets"
    print(f"Sheet: {label}; {q.min_grade} or better; {q.count} picks; odds {q.odds_lo:g}-{q.odds_hi:g}; "
          f"{len(rounds)} upcoming round(s); {q.output}.")
    if sh.mode == "Rough" and sh.picks:
        print("This is a Rough sheet: likely outcomes, priced for it. No evidence they beat break-even.")
    for i, gp in enumerate(sh.picks, 1):
        _print_pick(i, gp)
    if sh.note:
        print("\n" + sh.note)
    if sh.avoid:
        print(f"\n{len(sh.avoid)} selection(s) in scope grade Avoid (history below break-even), e.g. "
              + "; ".join(f"{g.obs.match.label()} {market_label(g.obs.market)} @ {g.obs.odds:.2f}"
                          for g in sh.avoid[:3]))
    if a.output == "acca" and len(sh.picks) > 1:
        print(f"\nAccumulator: odds {sh.combined_odds:.2f}, market chance {sh.combined_market:.1%}, "
              f"Vig estimate {sh.combined_estimate:.1%}, edge "
              f"{sh.combined_estimate * sh.combined_odds - 1:+.1%}, house cut {sh.house_cut:.1%}.")
        if sh.combined_estimate < LOW_CHANCE:
            print(f"Warning: combined chance is under {LOW_CHANCE:.0%}; most slips like this lose.")
    if a.ledger and sh.picks:
        led = Ledger(a.ledger)
        sheet_id = f"sheet-{len(led.records)}"
        for gp in sh.picks:
            g = gp.graded
            lo_, hi_ = g.interval()
            led.add_pick({
                "market": gp.obs.market, "odds": gp.obs.odds, "break_even": g.break_even,
                "market_prob": gp.obs.q, "history_rate": g.history_rate, "history_n": g.n,
                "estimate": g.estimate, "ci_low": lo_, "ci_high": hi_, "edge": g.edge,
                "grade": g.grade, "grade_reasons": [vars(t) for t in g.tests],
                "slice_key": gp.slice_key, "stats_version": STATS_VERSION, "sheet_id": sheet_id,
                "stake": 0, "shadow": True}, gp.obs.match)
        print(f"\nLogged {len(sh.picks)} picks to {a.ledger} in shadow mode (no stakes).")


def cmd_ledger(a) -> None:
    try:
        led = Ledger(a.ledger)
    except LedgerError as e:
        sys.exit(str(e))
    if a.action == "verify":
        print(f"{a.ledger}: {len(led.records)} records, hash chain intact, head {led.head[:12]}")
        return
    if a.action == "settle":
        if not a.results:
            sys.exit("settle needs --results (a vigs CSV or data/results.csv)")
        from .sportybet import RESULT_COLS, results_matches
        with open(a.results, encoding="utf-8") as fh:
            header = fh.readline().strip().split(",")
        matches = results_matches(a.results) if header == RESULT_COLS else load_csv(a.results)
        done, still = led.settle(matches)
        print(f"settled {done} pick(s); {still} still open")
        return
    print(f"Ledger {a.ledger}: flat one-unit stakes, shadow mode. 90% intervals.")
    for r in summarize(led):
        if r.n == 0:
            print(f"  {r.grade:<6s} no settled picks ({r.open} open)")
            continue
        print(f"  {r.grade:<6s} n {r.n}, hits {r.hits} (market expected {r.expected_market:.1f}, "
              f"Vig expected {r.expected_vig:.1f}), ROI {r.roi:+.1%} [{r.roi_low:+.1%}, "
              f"{r.roi_high:+.1%}], {r.open} open")
        if r.grade == "Solid":
            print("         Solid ROI interval is " + ("above zero." if r.roi_low > 0 else
                  "not above zero: no proof yet that Solid picks make money."))


def cmd_slip(a) -> None:
    odds = a.odds
    chances = [c / 100 for c in a.chances] if a.chances else [1 / o for o in odds]
    if len(chances) != len(odds):
        sys.exit("give one chance per leg")
    print(f"combined odds {combined_odds(odds):.2f}, chance {combined_prob(chances):.1%}, "
          f"house cut {house_cut(odds, chances):.1%}")


def cmd_fetch(a) -> None:
    import os
    import time as _time
    from . import sportybet as sb
    os.makedirs(a.data, exist_ok=True)
    client = sb.Client(delay=a.delay)
    if a.what == "results":
        now = int(_time.time() * 1000) - 5 * 60 * 1000
        added = sb.fetch_results(client, os.path.join(a.data, "results.csv"),
                                 now - int(a.days * 86400000), now)
        print(f"added {added} results in {client.requests} requests")
    elif a.what == "odds":
        n = sb.capture_odds(client, a.data)
        print(f"captured odds for {n} upcoming matches")
    else:
        sb.watch(client, a.data, a.minutes, a.interval, log=lambda m: print(m, flush=True))


def cmd_build(a) -> None:
    from .sportybet import build
    h, missing, u = build(a.data, a.history, a.upcoming)
    print(f"{a.history}: {h} settled matches with pre-kickoff odds "
          f"({missing} results have no odds captured); {a.upcoming}: {u} upcoming")


def cmd_study(a) -> None:
    from . import study as st
    rows = st.load_results(a.results)
    print(f"{len(rows)} results, {rows[0]['kickoff'][:16]} to {rows[-1]['kickoff'][:16]} UTC\n")
    print("Base rates by league")
    print(f"  {'league':<9s}{'n':>7s}" + "".join(f"{k:>9s}" for k in
          ("home", "draw", "away", "goals", "O1.5", "O2.5", "BTTS", "FH O0.5")))
    for lg, n, r in st.base_rates(rows):
        print(f"  {lg:<9s}{n:>7d}" + "".join(
            f"{v:>9.2f}" if k == "goals" else f"{v:>9.1%}" for k, v in r.items()))
    print("\nTeam strength stability (home-win rate, first vs second half of the window)")
    for lg, n, corr in st.stability(rows):
        print(f"  {lg:<9s} {n} teams, correlation {corr:+.2f}")
    eff = st.memory_tests(rows)
    print(f"\nMemory tests: {len(eff)} tested, strongest first (z vs the team's own base rate)")
    for e in eff[: a.top]:
        print(f"  {e.name:<46s} n {e.n:>6d}  {e.observed:6.1%} vs {e.expected:6.1%}  "
              f"z {e.z:+5.1f}  FDR q {e.q:.2f}")
    hrs = st.hour_tests(rows)
    worst = max(hrs, key=lambda e: abs(e.z))
    print(f"\nHour of day: strongest is {worst.name} {worst.observed:.2f} vs {worst.expected:.2f} "
          f"(z {worst.z:+.1f}, FDR q {worst.q:.2f}) across {len(hrs)} hours")
    sig = [e for e in eff + hrs if e.q < 0.10]
    print("\n" + (f"{len(sig)} effect(s) pass the false-discovery check at 10%."
                   if sig else "No effect passes the false-discovery check at 10%: "
                   "no sign the engine remembers recent results or the hour."))


def cmd_likely(a) -> None:
    import os
    import time as _time
    from collections import defaultdict
    from datetime import timedelta
    import json
    from . import blend as blend_mod
    from . import model as md
    from . import sportybet as sb
    from .grading import grade_model
    from .study import load_results
    client = sb.Client()
    blend_path = a.blend or os.path.join(a.data, "blend.json")
    blend_json = None
    if os.path.exists(blend_path):
        with open(blend_path, encoding="utf-8") as fh:
            blend_json = json.load(fh)
    res_path = os.path.join(a.data, "results.csv")
    now = int(_time.time() * 1000)
    if a.refresh:
        sb.fetch_results(client, res_path, now - 6 * 3600 * 1000, now - 60 * 1000,
                         log=lambda *_: None)
    rows = load_results(res_path)
    cutoff = rows[-1]["kickoff"]
    start = (datetime_from_iso(cutoff) - timedelta(days=a.days)).isoformat().replace("+00:00", "Z")
    rows = [r for r in rows if r["kickoff"] >= start]
    main = md.fit(rows)
    boots = md.ensemble(rows, reps=a.reps)
    hits: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        m = sb.results_matches_row(r)
        won = m.outcome(a.market)
        if won is None:
            continue
        for key in ((r["league"], r["home"], "home"), (r["league"], r["away"], "away")):
            hits[key][0] += won
            hits[key][1] += 1
    horizon = sb._iso(now + int(a.hours * 3600 * 1000))
    snaps = [s for e in client.upcoming() if (s := sb.snapshot(e, now))]
    snaps = [s for s in snaps if sb._iso(now) < s["kickoff"] <= horizon and a.market in s["odds"]]
    picks = []
    for s in snaps:
        m = sb.snapshot_match(s)
        est = md.predict_interval(main, boots, s["league"], s["home"], s["away"], a.market)
        if est is None or a.market not in m.fair:
            continue
        p, lo, hi = est
        bl = blend_mod.estimate(blend_json, a.market, m.fair[a.market], p,
                                md.rep_draws(boots, s["league"], s["home"], s["away"], a.market))
        p, lo, hi, source = bl or blend_mod.guarded(m.fair[a.market], p, lo, hi)
        h, ah = hits[(s["league"], s["home"], "home")], hits[(s["league"], s["away"], "away")]
        n = h[1] + ah[1]
        g = grade_model(m.odds[a.market], m.fair[a.market], p, (lo, hi),
                        (h[0] + ah[0]) / n if n else None, n)
        picks.append((s, m, g, source))
    picks.sort(key=lambda x: -x[2].estimate)
    picks = [x for x in picks if x[2].grade != "Avoid"][: a.count]
    sources = {x[3] for x in picks}
    print(f"{market_label(a.market)}: {len(snaps)} matches published for the next {a.hours:g} h; "
          f"model fitted on {len(rows)} results ({a.days:g} days). Ranked by likelihood.")
    print("Estimates from " + (" and ".join(sorted(sources)) or "the model")
          + ". Picks are Rough or Lean at best until the ledger validates an edge.\n")
    print(f"{'kickoff':<6s} {'league':<8s} {'match':<9s} {'odds':>5s} {'b-even':>7s} {'market':>7s} "
          f"{'history (n)':>15s} {'estimate [90%]':>22s} {'edge':>7s}  grade")
    lagos = timedelta(hours=1)
    for s, m, g, _src in picks:
        lo, hi = g.interval()
        ko = (m.kickoff + lagos).strftime("%H:%M")
        hist = f"{g.history_rate:.1%} ({g.n})" if g.history_rate is not None else "-"
        print(f"{ko:<6s} {s['league']:<8s} {m.home + '-' + m.away:<9s} {g.odds:>5.2f} "
              f"{g.break_even:>7.1%} {g.market_prob:>7.1%} {hist:>15s} "
              f"{g.estimate:>7.1%} [{lo:.1%}, {hi:.1%}] {g.edge:>+7.1%}  {g.grade}")
    print("\nKickoff times are Lagos (UTC+1). History: this market in the home side's home games "
          "plus the away side's away games.")
    if a.ledger and picks:
        os.makedirs(os.path.dirname(a.ledger) or ".", exist_ok=True)
        led = Ledger(a.ledger)
        logged = {(p["fixture"], p["market"]) for p in led.picks().values()}
        fresh = [x for x in picks if (x[1].key(), a.market) not in logged]
        for s, m, g, src in fresh:
            lo, hi = g.interval()
            led.add_pick({
                "market": a.market, "odds": g.odds, "break_even": g.break_even,
                "market_prob": g.market_prob, "history_rate": g.history_rate, "history_n": g.n,
                "estimate": g.estimate, "ci_low": lo, "ci_high": hi, "edge": g.edge,
                "grade": g.grade, "grade_reasons": [vars(t) for t in g.tests],
                "slice_key": (f"blend:v1|{a.market}" if src == "blend"
                              else f"guarded:70-30:{a.days:g}d|{a.market}"),
                "stats_version": STATS_VERSION, "source": src,
                "sheet_id": f"likely-{sb._iso(now)}", "stake": 0, "shadow": True,
                "event_id": s["event_id"]}, m)
        print(f"Logged {len(fresh)} picks to {a.ledger} (shadow mode, before kickoff)"
              + (f"; {len(picks) - len(fresh)} were already logged." if len(fresh) < len(picks) else "."))


def datetime_from_iso(s: str):
    from datetime import datetime
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def cmd_book(a) -> None:
    import time as _time
    from . import sportybet as sb
    led = Ledger(a.ledger)
    picks = [p for p in led.picks().values() if p["market"] == a.market and p.get("event_id")]
    if not picks:
        sys.exit(f"no picks for {a.market} in {a.ledger}")
    sheet = max(p["sheet_id"] for p in picks)
    soon = sb._iso(int(_time.time() * 1000) + a.buffer * 60 * 1000)
    live = [p for p in picks if p["sheet_id"] == sheet and (p.get("kickoff") or "") > soon]
    gone = sum(p["sheet_id"] == sheet for p in picks) - len(live)
    if not live:
        sys.exit(f"every pick in {sheet} has kicked off or starts within {a.buffer} minutes")
    live.sort(key=lambda p: p["kickoff"])
    client = sb.Client()
    sels = [sb.selection(p["market"], p["event_id"]) for p in live]
    code = sb.create_booking(client, sels)
    back, deadline, unavailable = sb.load_booking(client, code)
    want = {(s["eventId"], s["marketId"], s["specifier"] or None) for s in sels}
    got = {(b["eventId"], b["marketId"], b["specifier"] or None) for b in back}
    print(f"{market_label(a.market)}: booking code {code} ({len(sels)} selections"
          + (f"; {gone} skipped, already started" if gone else "") + ")")
    print(f"  load it: https://www.sportybet.com/ng/?shareCode={code}")
    print("  verified: code decodes to exactly these selections" if want == got else
          f"  WARNING: decoded selections differ ({len(got & want)} of {len(want)} match)")
    if live:
        from datetime import timedelta
        last = datetime_from_iso(max(p["kickoff"] for p in live)) + timedelta(hours=1)
        print(f"  last match kicks off at {last:%H:%M} Lagos; each match drops off the slip "
              "once it starts"
              + (f"; {unavailable} selection(s) unavailable" if unavailable else ""))
    for b in back:
        print(f"    {b['home']}-{b['away']}: {b['outcome']} @ {b['odds']}")
    led.add_booking(code, a.market, [p["id"] for p in live], deadline)


def cmd_export_model(a) -> None:
    import json
    import os
    from datetime import timedelta
    from . import model as md
    from .study import load_results
    rows = load_results(os.path.join(a.data, "results.csv"))
    start = (datetime_from_iso(rows[-1]["kickoff"]) - timedelta(days=a.days)).isoformat()
    rows = [r for r in rows if r["kickoff"] >= start.replace("+00:00", "Z")]
    out = md.export(rows, reps=a.reps)
    out["window_days"] = a.days
    from datetime import datetime, timezone
    out["exported_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"wrote {a.out}: {len(rows)} results, {len(out['leagues'])} leagues, "
          f"{os.path.getsize(a.out) // 1024} KB")


def cmd_export_record(a) -> None:
    import json
    from .record import export_record
    try:
        led = Ledger(a.ledger)
    except LedgerError as e:
        sys.exit(str(e))
    out = export_record(led)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    s = sum(g["settled"] for g in out["grades"].values())
    print(f"wrote {a.out}: {len(led.picks())} picks, {s} settled, chain intact")


def cmd_export_blend(a) -> None:
    import json
    from . import blend as bl
    rows = bl.training_rows(a.data)
    out = bl.evaluate(rows)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    on = [m for m, e in out["markets"].items() if e["active"]]
    print(f"wrote {a.out}: {out['matches']:,} settled matches with odds, {len(rows):,} rows; "
          f"blend active for {', '.join(on) if on else 'no market yet'}")
    for mk in ("FH_O05", "O15", "O25", "BY", "1"):
        e = out["markets"].get(mk)
        if e and "test" in e:
            t = e["test"]
            print(f"  {mk:<7s} held-out log loss: market {t['market']:.4f}, model {t['model']:.4f}, "
                  f"blend {t['blend']:.4f} (n {t['n']}). {e['reason']}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="vigs", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("fetch", help="pull SportyBet vFootball results or odds")
    p.add_argument("what", choices=("results", "odds", "watch"))
    p.add_argument("--data", default="data")
    p.add_argument("--days", type=float, default=7, help="results: how far back")
    p.add_argument("--minutes", type=float, default=60, help="watch: how long")
    p.add_argument("--interval", type=float, default=300, help="watch: seconds between polls")
    p.add_argument("--delay", type=float, default=1.2, help="seconds between requests")
    p.set_defaults(fn=cmd_fetch)

    p = sub.add_parser("likely", help="rank upcoming matches by results-model likelihood")
    p.add_argument("--market", default="FH_O05")
    p.add_argument("--hours", type=float, default=2)
    p.add_argument("--count", type=int, default=20)
    p.add_argument("--days", type=float, default=30, help="results window for the model")
    p.add_argument("--reps", type=int, default=20, help="bootstrap refits for the interval")
    p.add_argument("--data", default="data")
    p.add_argument("--ledger", default="ledger/trial.jsonl")
    p.add_argument("--blend", help="blend.json (default: <data>/blend.json if present)")
    p.add_argument("--no-refresh", dest="refresh", action="store_false")
    p.set_defaults(fn=cmd_likely)

    p = sub.add_parser("book", help="SportyBet booking code for the latest list of a market")
    p.add_argument("--market", default="FH_O05")
    p.add_argument("--ledger", default="ledger/trial.jsonl")
    p.add_argument("--buffer", type=int, default=2, help="skip matches starting within N minutes")
    p.set_defaults(fn=cmd_book)

    p = sub.add_parser("export-model", help="write the fitted model as JSON for the web app")
    p.add_argument("--data", default="data")
    p.add_argument("--out", default="data/model.json")
    p.add_argument("--days", type=float, default=30)
    p.add_argument("--reps", type=int, default=20)
    p.set_defaults(fn=cmd_export_model)

    p = sub.add_parser("export-blend", help="learn the market/model blend and write blend.json")
    p.add_argument("--data", default="data")
    p.add_argument("--out", default="data/blend.json")
    p.set_defaults(fn=cmd_export_blend)

    p = sub.add_parser("export-record", help="write the ledger scorecard as JSON for the web app")
    p.add_argument("--ledger", default="data/ledger.jsonl")
    p.add_argument("--out", default="data/record.json")
    p.set_defaults(fn=cmd_export_record)

    p = sub.add_parser("study", help="results-only base rates and memory tests")
    p.add_argument("--results", default="data/results.csv")
    p.add_argument("--top", type=int, default=12)
    p.set_defaults(fn=cmd_study)

    p = sub.add_parser("build", help="join results and odds into vigs CSVs")
    p.add_argument("--data", default="data")
    p.add_argument("--history", default="data/history.csv")
    p.add_argument("--upcoming", default="data/upcoming.csv")
    p.set_defaults(fn=cmd_build)

    def grading_args(p) -> None:
        p.add_argument("--market", help="comma list, e.g. O15,FH_O05 (default: all)")
        p.add_argument("--k", type=float, default=200, help="prior strength")
        p.add_argument("--min-days", dest="min_days", type=float, default=30)
        p.add_argument("--devig", choices=("proportional", "shin"), default="proportional")

    p = sub.add_parser("evidence", help="calibration and graded slices from history")
    p.add_argument("csv")
    p.add_argument("--top", type=int, default=15)
    p.add_argument("--min-n", dest="min_n", type=int, default=100)
    grading_args(p)
    p.set_defaults(fn=cmd_evidence)

    p = sub.add_parser("sheet", help="graded picks for upcoming rounds")
    p.add_argument("history")
    p.add_argument("upcoming")
    p.add_argument("--count", type=int, default=10)
    p.add_argument("--min-grade", dest="min_grade", default="lean",
                   choices=("solid", "lean", "rough"))
    p.add_argument("--odds", default="1.01-1000", help="range, e.g. 1.05-1.5")
    p.add_argument("--rounds", type=int, default=2, help="upcoming rounds to cover")
    p.add_argument("--max-per-round", dest="max_per_round", type=int)
    p.add_argument("--output", choices=("singles", "acca"), default="singles")
    p.add_argument("--ledger", default="ledger.jsonl", help="'' to skip logging")
    grading_args(p)
    p.set_defaults(fn=cmd_sheet)

    p = sub.add_parser("ledger", help="verify, settle or report the pick ledger")
    p.add_argument("action", choices=("report", "settle", "verify"))
    p.add_argument("--ledger", default="ledger.jsonl")
    p.add_argument("--results")
    p.set_defaults(fn=cmd_ledger)

    p = sub.add_parser("slip", help="combined odds, chance and house cut")
    p.add_argument("odds", type=float, nargs="+")
    p.add_argument("--chances", type=float, nargs="+", help="market chance per leg, in %%")
    p.set_defaults(fn=cmd_slip)

    p = sub.add_parser("synth", help="generate SYNTHETIC data to test the pipeline")
    p.add_argument("--out", default="synthetic.csv")
    p.add_argument("--weeks", type=int, default=60)
    p.add_argument("--teams", type=int, default=20)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--margin", type=float, default=0.06)
    p.add_argument("--plant", type=int, default=0, help="give N teams an edge the odds omit")
    p.add_argument("--played", type=int, default=None, help="leave later rounds unsettled")
    p.add_argument("--skew", nargs="*", help="mispriced market, e.g. O15=1.15")
    p.add_argument("--league", default="England")
    p.add_argument("--minutes", type=float, default=5.0, help="minutes between rounds")
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
