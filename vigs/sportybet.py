"""SportyBet vFootball client: results archive and pre-match odds.

Endpoints are SportyBet's own public web API (the ones its site calls).
Results reach back months but carry no odds; odds exist only for rounds not
yet played (usually just the next one per league). So odds are snapshotted
live and joined to results by event id when the round settles.

Be polite: one request at a time with a delay. Personal use only.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Iterator

BASE = "https://www.sportybet.com/api/ng/factsCenter"
ORDERS = "https://www.sportybet.com/api/ng/orders"
OPER_ID = "2"                         # SportyBet Nigeria
SPORT = "sr:sport:202120001"          # vFootball
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
# 1 = 1X2, 18 = total goals, 68 = first-half total, 29 = both teams score
MARKET_IDS = "1,18,68,29"
PAGE = 100
RESULT_COLS = ["event_id", "league", "kickoff", "home", "away", "hg", "ag", "ht_hg", "ht_ag"]


class ApiError(Exception):
    pass


class Client:
    def __init__(self, delay: float = 1.2, retries: int = 4) -> None:
        self.delay = delay
        self.retries = retries
        self._last = 0.0
        self.requests = 0

    def get(self, path: str, base: str = BASE, body: Any = None, **params: Any) -> Any:
        url = f"{base}/{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = {"User-Agent": UA, "Accept": "application/json",
                   "Referer": "https://www.sportybet.com/ng/sport/vFootball"}
        data = None
        if base == ORDERS:
            headers["OperId"] = OPER_ID       # orders calls fail validation without it
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json;charset=UTF-8"
        req = urllib.request.Request(url, data=data, headers=headers)
        for attempt in range(self.retries + 1):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = json.load(resp)
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                if attempt == self.retries:
                    raise ApiError(f"{path}: {e}") from None
                time.sleep(2 ** (attempt + 1))
                continue
            if body.get("bizCode") != 10000:
                raise ApiError(f"{path}: {body.get('bizCode')} {body.get('message')}")
            return body.get("data") or {}
        raise ApiError(path)

    def results(self, start_ms: int, end_ms: int) -> Iterator[dict]:
        page = 1
        while True:
            data = self.get("eventResultList", pageNum=page, pageSize=PAGE, sportId=SPORT,
                            startTime=start_ms, endTime=end_ms)
            events = [e for t in data.get("tournaments") or [] for e in t.get("events", [])]
            yield from events
            if not events or page * PAGE >= int(data.get("totalNum") or 0):
                return
            page += 1

    def upcoming(self) -> list[dict]:
        out: list[dict] = []
        page = 1
        while True:
            data = self.get("pcUpcomingEvents", sportId=SPORT, marketId=MARKET_IDS,
                            pageSize=PAGE, pageNum=page, option=1)
            events = [e for t in data.get("tournaments") or [] for e in t.get("events", [])]
            out += events
            if not events or page * PAGE >= int(data.get("totalNum") or 0):
                return out
            page += 1


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


def _score(s: str | None) -> tuple[int, int] | None:
    try:
        a, b = str(s).split(":")
        return int(a), int(b)
    except (ValueError, AttributeError):
        return None


def parse_result(e: dict) -> dict | None:
    """Final and half-time score of a finished match, or None if incomplete."""
    if e.get("matchStatus") != "End":
        return None
    ft = _score(e.get("setScore"))
    halves = e.get("regularTimeScore") or e.get("gameScore") or []
    ht = _score(halves[0]) if halves else None
    if ft is None:
        return None
    return {"event_id": e["eventId"], "league": e["sport"]["category"]["name"],
            "kickoff": _iso(int(e["estimateStartTime"])), "home": e["homeTeamName"],
            "away": e["awayTeamName"], "hg": ft[0], "ag": ft[1],
            "ht_hg": ht[0] if ht else "", "ht_ag": ht[1] if ht else ""}


def parse_odds(e: dict) -> dict[str, float]:
    """Map SportyBet markets to vigs market keys. A group is kept only when every
    outcome in it is active, since de-vigging needs the whole group."""
    out: dict[str, float] = {}
    for m in e.get("markets") or []:
        if str(m.get("status", 0)) != "0":
            continue
        outs = m.get("outcomes") or []
        if not outs or any(not o.get("isActive") for o in outs):
            continue
        try:
            prices = {o["desc"]: float(o["odds"]) for o in outs}
        except (KeyError, TypeError, ValueError):
            continue
        mid, spec = str(m.get("id")), m.get("specifier") or ""
        if mid == "1" and {"Home", "Draw", "Away"} <= prices.keys():
            out.update({"1": prices["Home"], "X": prices["Draw"], "2": prices["Away"]})
        elif mid == "29" and {"Yes", "No"} <= prices.keys():
            out.update({"BY": prices["Yes"], "BN": prices["No"]})
        elif mid in ("18", "68") and spec.startswith("total="):
            line = spec.split("=", 1)[1]
            if len(line) != 3 or line[1] != "." or not line.replace(".", "").isdigit():
                continue
            key = line.replace(".", "")
            pre = "FH_" if mid == "68" else ""
            over, under = prices.get(f"Over {line}"), prices.get(f"Under {line}")
            if over and under and over > 1.0 and under > 1.0:
                out[f"{pre}O{key}"], out[f"{pre}U{key}"] = over, under
    return out


def snapshot(e: dict, captured_ms: int) -> dict | None:
    odds = parse_odds(e)
    if not {"1", "X", "2"} <= odds.keys():
        return None
    return {"event_id": e["eventId"], "captured_at": _iso(captured_ms),
            "kickoff": _iso(int(e["estimateStartTime"])),
            "league": e["sport"]["category"]["name"], "home": e["homeTeamName"],
            "away": e["awayTeamName"], "odds": odds}


# ---------------------------------------------------------------- storage --

def known_results(path: str) -> set[str]:
    if not os.path.exists(path):
        return set()
    with open(path, newline="", encoding="utf-8") as fh:
        return {row["event_id"] for row in csv.DictReader(fh)}


def append_results(path: str, rows: list[dict]) -> None:
    new = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, RESULT_COLS)
        if new:
            w.writeheader()
        w.writerows(rows)


def fetch_results(client: Client, path: str, start_ms: int, end_ms: int,
                  window_ms: int = 6 * 3600 * 1000, log=print) -> int:
    """Pull results in closed time windows, newest first, skipping known events."""
    seen = known_results(path)
    added = 0
    end = end_ms
    while end > start_ms:
        start = max(start_ms, end - window_ms)
        rows = []
        for e in client.results(start, end):
            r = parse_result(e)
            if r and r["event_id"] not in seen:
                seen.add(r["event_id"])
                rows.append(r)
        append_results(path, rows)
        added += len(rows)
        log(f"  {_iso(start)[:16]} to {_iso(end)[:16]}: +{len(rows)} (total new {added}, "
            f"{client.requests} requests)")
        end = start
    return added


def odds_path(data_dir: str, ms: int) -> str:
    """Odds snapshots are kept in one file per UTC day."""
    return os.path.join(data_dir, "odds", _iso(ms)[:10] + ".jsonl")


def capture_odds(client: Client, data_dir: str, last: dict[str, dict] | None = None) -> int:
    """Append a snapshot for every upcoming match whose odds are new or changed."""
    now = int(time.time() * 1000)
    last = {} if last is None else last
    snaps = []
    for e in client.upcoming():
        s = snapshot(e, now)
        if s and last.get(s["event_id"]) != s["odds"]:
            last[s["event_id"]] = s["odds"]
            snaps.append(s)
    path = odds_path(data_dir, now)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for s in snaps:
            fh.write(json.dumps(s, sort_keys=True) + "\n")
    return len(snaps)


def watch(client: Client, data_dir: str, minutes: float, interval: float = 300, log=print) -> None:
    """Snapshot odds and pull recent results every `interval` seconds."""
    os.makedirs(data_dir, exist_ok=True)
    stop = time.time() + minutes * 60
    last: dict[str, dict] = {}
    while True:
        now = int(time.time() * 1000)
        try:
            n = capture_odds(client, data_dir, last)
            r = fetch_results(client, os.path.join(data_dir, "results.csv"),
                              now - 2 * 3600 * 1000, now - 60 * 1000, log=lambda *_: None)
            log(f"{_iso(now)[:19]} odds snapshots {n}, new results {r}")
        except ApiError as e:
            log(f"{_iso(now)[:19]} error: {e}")
        if time.time() + interval > stop:
            return
        time.sleep(interval)


# ------------------------------------------------------------------- build --

def build(data_dir: str, history_out: str, upcoming_out: str) -> tuple[int, int, int]:
    """Join results to the last odds snapshot taken before kickoff and write
    vigs CSVs. Returns (history rows, results without odds, upcoming rows)."""
    snaps: dict[str, dict] = {}
    files = sorted(glob.glob(os.path.join(data_dir, "odds", "*.jsonl")))
    files += [f for f in [os.path.join(data_dir, "odds.jsonl")] if os.path.exists(f)]
    for path in files:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                s = json.loads(line)
                if s["captured_at"] > s["kickoff"]:
                    continue                      # never use odds seen after kickoff
                prev = snaps.get(s["event_id"])
                if prev is None or s["captured_at"] > prev["captured_at"]:
                    snaps[s["event_id"]] = s
    results: dict[str, dict] = {}
    res_path = os.path.join(data_dir, "results.csv")
    if os.path.exists(res_path):
        with open(res_path, newline="", encoding="utf-8") as fh:
            results = {r["event_id"]: r for r in csv.DictReader(fh)}

    markets = sorted({k for s in snaps.values() for k in s["odds"]})
    from .data import _market_order, column_for
    markets.sort(key=_market_order)
    cols = ["league", "season", "week", "kickoff", "home", "away", "hg", "ag", "ht_hg", "ht_ag"]
    header = cols + [column_for(m) for m in markets]

    def row(s: dict, r: dict | None) -> list:
        ko = s["kickoff"]
        week = int(datetime.fromisoformat(ko.replace("Z", "+00:00")).timestamp() // 60)
        base = [s["league"], "", week, ko, s["home"], s["away"]]
        base += [r[c] for c in ("hg", "ag", "ht_hg", "ht_ag")] if r else ["", "", "", ""]
        return base + [s["odds"].get(m, "") for m in markets]

    hist = sorted(((s, results[eid]) for eid, s in snaps.items() if eid in results),
                  key=lambda x: (x[0]["kickoff"], x[0]["league"], x[0]["event_id"]))
    now = _iso(int(time.time() * 1000))
    up = sorted((s for eid, s in snaps.items() if eid not in results and s["kickoff"] > now),
                key=lambda s: (s["kickoff"], s["league"], s["event_id"]))
    for path, rows in ((history_out, [row(s, r) for s, r in hist]),
                       (upcoming_out, [row(s, None) for s in up])):
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)
    return len(hist), len(results) - len(hist), len(up)


def snapshot_match(s: dict):
    """A vigs Match for an odds snapshot, keyed the same way `build` keys rows."""
    from .data import Match
    from .odds import LIVE_DEVIG
    ko = datetime.fromisoformat(s["kickoff"].replace("Z", "+00:00"))
    return Match(0, "", int(ko.timestamp() // 60), 0, s["home"], s["away"], s["odds"],
                 league=s["league"], kickoff=ko, devig_method=LIVE_DEVIG)


def results_matches_row(r: dict):
    """One results.csv row as a vigs Match (no odds), keyed like `build` rows."""
    from .data import Match
    ko = datetime.fromisoformat(r["kickoff"].replace("Z", "+00:00"))
    ht = r.get("ht_hg") not in ("", None)
    return Match(0, "", int(ko.timestamp() // 60), 0, r["home"], r["away"], {},
                 int(r["hg"]), int(r["ag"]), int(r["ht_hg"]) if ht else None,
                 int(r["ht_ag"]) if ht else None, r["league"], ko)


def results_matches(path: str) -> list:
    with open(path, newline="", encoding="utf-8") as fh:
        return [results_matches_row(r) for r in csv.DictReader(fh)]


# ---------------------------------------------------------------- booking --
# A booking code ("Book a bet") is a shareable list of selections. Creating one
# needs no login and places nothing; the user loads it in SportyBet and decides.

def selection(market: str, event_id: str) -> dict:
    """The SportyBet selection for a vigs market key."""
    if market in ("1", "X", "2"):
        return {"eventId": event_id, "marketId": "1", "specifier": None,
                "outcomeId": {"1": "1", "X": "2", "2": "3"}[market]}
    if market in ("BY", "BN"):
        return {"eventId": event_id, "marketId": "29", "specifier": None,
                "outcomeId": "74" if market == "BY" else "76"}
    fh = market.startswith("FH_")
    key = market[3:] if fh else market
    side, line = key[0], f"{key[1]}.{key[2]}"
    return {"eventId": event_id, "marketId": "68" if fh else "18",
            "specifier": f"total={line}", "outcomeId": "12" if side == "O" else "13"}


def create_booking(client: Client, selections: list[dict]) -> str:
    data = client.get("share", base=ORDERS, body={"selections": selections})
    code = data.get("shareCode")
    if not code:
        raise ApiError(f"no booking code returned: {data}")
    return code


def load_booking(client: Client, code: str) -> tuple[list[dict], int, int]:
    """Decode a booking code: its selections (eventId, home, away, market,
    specifier, outcome, odds), its deadline in ms, and how many are unavailable."""
    data = client.get(f"share/{code}", base=ORDERS)
    out = []
    for e in data.get("outcomes") or []:
        m = (e.get("markets") or [{}])[0]
        o = (m.get("outcomes") or [{}])[0]
        out.append({"eventId": e.get("eventId"), "home": e.get("homeTeamName"),
                    "away": e.get("awayTeamName"), "marketId": str(m.get("id")),
                    "specifier": m.get("specifier"), "outcome": o.get("desc"),
                    "odds": o.get("odds")})
    return out, int(data.get("deadline") or 0), len(data.get("unavailableOutcomes") or [])
