"""Record SportyBet virtual football network traffic for schema discovery.

Run this on your own computer (it opens a visible browser):

    pip install playwright && playwright install chromium
    python tools/record_feed.py --out feed.jsonl
    python tools/record_feed.py --summarize feed.jsonl

Open virtual football in the browser window and leave it on the league pages
through several full rounds, ideally across a season rollover. Every WebSocket
frame (page and iframes, both directions) and every JSON HTTP response is
appended to the output file, one JSON object per line. Nothing is parsed or
guessed here: the recording is the evidence for docs/feed-schema.md.

It never logs in, never places bets and stores no credentials. Recording a
site's traffic may breach its terms: keep it personal and polite.
"""
from __future__ import annotations

import argparse
import base64
import json
import signal
import sys
import time
from collections import Counter
from typing import Any

DEFAULT_URL = "https://www.sportybet.com/ng/virtual"


class Recorder:
    def __init__(self, path: str) -> None:
        self.fh = open(path, "a", encoding="utf-8")
        self.count: Counter[str] = Counter()

    def write(self, kind: str, **fields: Any) -> None:
        rec = {"ts": round(time.time(), 3), "kind": kind, **fields}
        self.fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.fh.flush()
        self.count[kind] += 1

    def payload(self, data: str | bytes) -> dict[str, str]:
        if isinstance(data, bytes):
            return {"b64": base64.b64encode(data).decode()}
        return {"text": data}

    def attach(self, page: Any) -> None:
        def on_ws(ws: Any) -> None:
            url = ws.url
            self.write("ws_open", url=url)
            ws.on("framereceived", lambda d: self.write("ws_recv", url=url, **self.payload(d)))
            ws.on("framesent", lambda d: self.write("ws_sent", url=url, **self.payload(d)))
            ws.on("close", lambda _ws: self.write("ws_close", url=url))

        def on_response(resp: Any) -> None:
            ctype = resp.headers.get("content-type", "")
            if "json" not in ctype:
                return
            try:
                body = resp.text()
            except Exception:              # body gone (redirect, aborted, navigation)
                return
            self.write("http", url=resp.url, status=resp.status,
                       frame=resp.frame.url if resp.frame else None, text=body)

        page.on("websocket", on_ws)
        page.on("response", on_response)
        page.on("framenavigated", lambda f: self.write("frame", url=f.url,
                                                        child=f.parent_frame is not None))


def record(url: str, out: str, headless: bool, seconds: float | None,
           executable: str | None) -> None:
    from playwright.sync_api import sync_playwright

    rec = Recorder(out)
    stop = {"now": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(now=True))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless, executable_path=executable)
        context = browser.new_context()
        context.on("page", rec.attach)
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded")
        print(f"recording to {out}; press Ctrl+C to stop", file=sys.stderr)
        start = last = time.time()
        while not stop["now"] and (seconds is None or time.time() - start < seconds):
            page.wait_for_timeout(500)
            if time.time() - last >= 30:
                last = time.time()
                print("  " + ", ".join(f"{k} {v}" for k, v in sorted(rec.count.items())),
                      file=sys.stderr)
        browser.close()
    print(f"done: {dict(rec.count)}", file=sys.stderr)


def _shape(obj: Any, depth: int = 0) -> str:
    """A compact structural fingerprint of a JSON value."""
    if depth > 2:
        return "..."
    if isinstance(obj, dict):
        return "{" + ",".join(f"{k}:{_shape(v, depth + 1)}" for k, v in sorted(obj.items())[:12]) + "}"
    if isinstance(obj, list):
        return "[" + (_shape(obj[0], depth + 1) if obj else "") + "]"
    return type(obj).__name__


def summarize(path: str, top: int = 25) -> None:
    kinds: Counter[str] = Counter()
    urls: Counter[str] = Counter()
    shapes: Counter[str] = Counter()
    examples: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            kinds[rec["kind"]] += 1
            if rec["kind"] in ("ws_recv", "ws_sent", "http"):
                urls[f"{rec['kind']} {rec['url'].split('?')[0]}"] += 1
                text = rec.get("text")
                if text is None:
                    shape = "binary"
                else:
                    try:
                        shape = _shape(json.loads(text))
                    except ValueError:
                        shape = "text:" + text[:40]
                key = f"{rec['kind']} {shape}"
                shapes[key] += 1
                examples.setdefault(key, (text or rec.get("b64", ""))[:300])
    print("record kinds:", dict(kinds))
    print("\nbusiest endpoints:")
    for u, n in urls.most_common(top):
        print(f"  {n:>7d}  {u}")
    print("\nmessage shapes (first 300 chars of one example each):")
    for s, n in shapes.most_common(top):
        print(f"  {n:>7d}  {s[:160]}")
        print(f"           e.g. {examples[s]!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default="feed.jsonl")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--seconds", type=float, help="stop after this long")
    ap.add_argument("--chromium", help="path to a Chromium binary")
    ap.add_argument("--summarize", metavar="JSONL", help="summarise a recording and exit")
    a = ap.parse_args()
    if a.summarize:
        summarize(a.summarize)
    else:
        record(a.url, a.out, a.headless, a.seconds, a.chromium)


if __name__ == "__main__":
    main()
