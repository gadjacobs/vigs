// The background pass, run in GitHub Actions (.github/workflows/tick.yml) on
// GitHub's CPU: same work as /api/push/tick. Loops until TICK_UNTIL (unix
// seconds). While a watched leg plays a pass starts every 12 seconds, counted
// from the start of the last one (a pass takes a few seconds itself); otherwise
// as long as the pass asks (2 minutes when idle). Needs the store (REDIS_URL,
// or UPSTASH_REDIS_REST_URL and _TOKEN).
//
// TICK_GUARD=1 (a scheduled safety-net run): if another run ticked in the last
// 90 seconds the chain is alive, so this one leaves with exit code 78.
import { lastTick } from "../lib/push.ts";
import { runTickOnce } from "../lib/ticker.ts";

const LIVE_EVERY = 12; // seconds between pass starts while something plays
const until = Number(process.env.TICK_UNTIL ?? 0) * 1000 || Date.now() + 55 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.env.TICK_GUARD === "1") {
  const at = await lastTick().catch(() => null);
  if (at && Date.now() - at < 90_000) {
    console.log(`tick: another run ticked ${Math.round((Date.now() - at) / 1000)}s ago; leaving it to that one`);
    process.exit(78);
  }
}

let passes = 0, took = 0, slowest = 0;
while (Date.now() < until) {
  const started = Date.now();
  let next = 120;
  try {
    const out = await runTickOnce() as { next?: number; error?: string };
    next = Number(out.next) || 120;
    if (out.error) console.log(`tick: ${out.error}`);
  } catch (e) {
    console.log(`tick failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  const ms = Date.now() - started;
  took += ms;
  slowest = Math.max(slowest, ms);
  if (++passes % 30 === 1) {
    console.log(`tick: ${passes} passes, last 30 averaged ${(took / Math.min(passes, 30) / 1000).toFixed(1)}s (slowest ${(slowest / 1000).toFixed(1)}s), next in ${next}s`);
    took = 0;
    slowest = 0;
  }
  // "20" from a pass means something is live: start the next one LIVE_EVERY
  // seconds after this one started, but always leave SportyBet 3 seconds.
  const every = next <= 20 ? LIVE_EVERY : Math.min(300, next);
  await sleep(Math.min(Math.max(3000, every * 1000 - ms), Math.max(0, until - Date.now())));
}
process.exit(0);
