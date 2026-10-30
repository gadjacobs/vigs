// The background pass, run by the collector inside GitHub Actions instead of
// on Vercel: same work as /api/push/tick, but its CPU is GitHub's. Loops until
// TICK_UNTIL (unix seconds), waiting as long as each pass asks: about 20 s while
// a watched leg plays, 2 minutes otherwise. Needs REDIS_URL (the store).
import { runTickOnce } from "../lib/ticker.ts";

const until = Number(process.env.TICK_UNTIL ?? 0) * 1000 || Date.now() + 55 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passes = 0;
while (Date.now() < until) {
  let next = 120;
  try {
    const out = await runTickOnce() as { next?: number; error?: string };
    next = Number(out.next) || 120;
    if (out.error) console.log(`tick: ${out.error}`);
  } catch (e) {
    console.log(`tick failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  if (++passes % 30 === 1) console.log(`tick: ${passes} passes, next in ${next}s`);
  await sleep(Math.min(Math.min(300, Math.max(15, next)) * 1000, Math.max(0, until - Date.now())));
}
process.exit(0);
