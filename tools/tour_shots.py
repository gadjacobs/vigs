"""Capture the first-run tour's screens from a running Vig web app.

Usage: python tools/tour_shots.py http://localhost:3000

Writes web/public/tour/*.jpg and web/lib/tour-spots.json (the box each slide points at,
as percentages of its image). Needs Playwright and an app with live SportyBet data, so
the screens show real matches; run it again whenever the screens change.
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

W, H = 390, 520  # each image: a phone-wide slice of the page around its spot
ROOT = os.path.join(os.path.dirname(__file__), "..", "web")
OUT = os.path.join(ROOT, "public", "tour")
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
# Notifications on, without a real push service, so the bell menus render.
STUB = """
const fake = { pushManager: { getSubscription: async () => ({ endpoint: 'https://push.invalid/x' }) } };
Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => fake, register: async () => fake, ready: Promise.resolve(fake), addEventListener(){} } });
"""


def shot(pg, name, target, spots, lead=0.4):
    """Save a W x H slice with the target about `lead` of the way down, and its box."""
    target.scroll_into_view_if_needed()
    pg.wait_for_timeout(200)
    box = target.bounding_box()
    top = box["y"] + pg.evaluate("scrollY")
    y0 = max(0, top - (H - box["height"]) * lead)
    pg.evaluate("y => scrollTo(0, y)", y0)
    pg.wait_for_timeout(400)
    y0 = pg.evaluate("scrollY")
    pg.screenshot(path=os.path.join(OUT, f"{name}.jpg"), type="jpeg", quality=80,
                  clip={"x": 0, "y": 0, "width": W, "height": H}, animations="disabled")
    pad = 5
    spots[name] = {
        "src": f"/tour/{name}.jpg", "w": W, "h": H,
        "spot": {k: round(v, 1) for k, v in {
            "x": max(0, box["x"] - pad) / W * 100,
            "y": max(0, top - y0 - pad) / H * 100,
            "w": min(W, box["width"] + 2 * pad) / W * 100,
            "h": (box["height"] + 2 * pad) / H * 100,
        }.items()},
    }
    print(name, spots[name]["spot"])


def main(base):
    os.makedirs(OUT, exist_ok=True)
    spots = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        ctx = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=2, color_scheme="light")
        ctx.add_cookies([{"name": n, "value": v, "url": base} for n, v in (("vig_onb", "1"), ("vig_view", "simple"))])
        ctx.add_init_script(STUB)
        # The bottom bar and slip dock float over the page; leave them out, and give
        # the page room below so any spot can sit where the slice wants it.
        ctx.add_init_script("addEventListener('DOMContentLoaded', () => document.head.insertAdjacentHTML('beforeend',"
                            " '<style>.mainnav,.dock,.toast{display:none!important}body{padding-bottom:600px!important}</style>'))")
        pg = ctx.new_page()

        pg.goto(f"{base}/", wait_until="networkidle")
        shot(pg, "tonight", pg.locator("button.primary", has_text="Build slip"), spots, lead=0.75)

        pg.goto(f"{base}/picks", wait_until="networkidle")
        acts = pg.locator(".slate .slateactions").first
        pg.wait_for_function("document.querySelector('.slate .slateactions')?.innerText.match(/[A-Z0-9]{6}/)", timeout=60000)
        code = re.search(r"\b[A-Z0-9]{6,8}\b", acts.inner_text()).group(0)
        shot(pg, "picks", acts, spots, lead=0.7)

        now = int(time.time() * 1000)
        saved = [{"code": code, "at": now, "legs": 0, "odds": 0, "last": now + 3600_000}]
        pg.evaluate("c => localStorage.setItem('vig_codes', c)", json.dumps(saved))
        pg.goto(f"{base}/codes", wait_until="load")
        pg.wait_for_selector(".chancebig", timeout=60000)
        pg.wait_for_timeout(2500)
        shot(pg, "codes", pg.locator(".codecard .chancebig").first, spots, lead=0.3)
        pg.locator(".alertmenu > summary").first.click()
        pg.wait_for_timeout(500)
        shot(pg, "bell", pg.locator(".alertpop").first, spots, lead=0.75)

        pg.goto(f"{base}/record", wait_until="networkidle")
        shot(pg, "record", pg.locator(".tiles .tile").nth(1), spots, lead=0.35)
        b.close()
    with open(os.path.join(ROOT, "lib", "tour-spots.json"), "w") as f:
        json.dump(spots, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:3000")
