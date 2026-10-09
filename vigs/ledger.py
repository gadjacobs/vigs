"""Append-only, hash-chained pick ledger (JSON lines).

Every pick is written before kickoff and settled later by appending a
settlement record. Nothing is ever edited or deleted: each record carries the
hash of the one before it, so any edit breaks the chain and loading fails.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from .data import Match

GENESIS = "0" * 64


class LedgerError(Exception):
    pass


def _digest(seq: int, kind: str, prev: str, data: dict[str, Any]) -> str:
    body = json.dumps({"seq": seq, "type": kind, "prev": prev, "data": data},
                      sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Ledger:
    def __init__(self, path: str) -> None:
        self.path = path
        self.records: list[dict[str, Any]] = []
        if os.path.exists(path):
            self._load()

    def _load(self) -> None:
        prev = GENESIS
        with open(self.path, encoding="utf-8") as fh:
            for i, line in enumerate(fh):
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                    ok = (rec["seq"] == i and rec["prev"] == prev
                          and rec["hash"] == _digest(rec["seq"], rec["type"], prev, rec["data"]))
                except (ValueError, KeyError, TypeError):
                    ok = False
                if not ok:
                    raise LedgerError(f"{self.path}: record {i} fails the hash chain; "
                                      "the ledger was edited")
                self.records.append(rec)
                prev = rec["hash"]

    @property
    def head(self) -> str:
        return self.records[-1]["hash"] if self.records else GENESIS

    def _append(self, kind: str, data: dict[str, Any]) -> dict[str, Any]:
        seq = len(self.records)
        rec = {"seq": seq, "type": kind, "prev": self.head, "data": data}
        rec["hash"] = _digest(seq, kind, rec["prev"], data)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        self.records.append(rec)
        return rec

    def picks(self) -> dict[str, dict[str, Any]]:
        return {r["data"]["id"]: r["data"] for r in self.records if r["type"] == "pick"}

    def settlements(self) -> dict[str, dict[str, Any]]:
        return {r["data"]["id"]: r["data"] for r in self.records if r["type"] == "settle"}

    def add_pick(self, pick: dict[str, Any], match: Match) -> str:
        if match.settled:
            raise LedgerError(f"{match.label()} already has a result; picks are logged "
                              "before kickoff only")
        pick = dict(pick, fixture=match.key(), generated_at=now_utc(),
                    kickoff=match.kickoff.isoformat() if match.kickoff else None)
        pick["id"] = hashlib.sha256(
            f"{pick['fixture']}|{pick['market']}|{pick['generated_at']}|{len(self.records)}"
            .encode()).hexdigest()[:12]
        self._append("pick", pick)
        return pick["id"]

    def settle(self, matches: Iterable[Match]) -> tuple[int, int]:
        """Settle open picks from results. Returns (settled now, still open)."""
        done = self.settlements()
        by_key = {m.key(): m for m in matches if m.settled}
        settled = still_open = 0
        for pid, p in self.picks().items():
            if pid in done:
                continue
            m = by_key.get(p["fixture"])
            won = m.outcome(p["market"]) if m else None
            if won is None:
                still_open += 1
                continue
            self._append("settle", {"id": pid, "won": won, "void": False,
                                    "score": f"{m.hg}-{m.ag}", "settled_at": now_utc()})
            settled += 1
        return settled, still_open


@dataclass
class GradeRecord:
    grade: str
    n: int
    hits: int
    expected_market: float      # hits the market chance predicted
    expected_vig: float         # hits the Vig estimate predicted
    roi: float
    roi_low: float
    roi_high: float
    open: int


def summarize(ledger: Ledger, shadow_only: bool = True, seed: int = 0) -> list[GradeRecord]:
    """Flat one-unit stakes per pick, by grade, with a 90% bootstrap ROI interval."""
    picks, done = ledger.picks(), ledger.settlements()
    out = []
    for g in ("Solid", "Lean", "Rough"):
        mine = [p for p in picks.values() if p["grade"] == g]
        rows = [(p, done[p["id"]]) for p in mine if p["id"] in done and not done[p["id"]]["void"]]
        profits = [p["odds"] - 1 if s["won"] else -1.0 for p, s in rows]
        lo = hi = 0.0
        if profits:
            rng = random.Random(seed)
            n = len(profits)
            means = sorted(sum(rng.choices(profits, k=n)) / n for _ in range(2000))
            lo, hi = means[100], means[1899]
        out.append(GradeRecord(
            g, len(rows), sum(s["won"] for _, s in rows),
            sum(p["market_prob"] for p, _ in rows), sum(p["estimate"] for p, _ in rows),
            sum(profits) / len(profits) if profits else 0.0, lo, hi, len(mine) - len(rows)))
    return out
