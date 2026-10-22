import { lastRefusedTick, lastTick, lastTickError, type TickError } from "@/lib/push";
import { storeSource } from "@/lib/store";
import { memory, type Memory } from "@/lib/tidy";

/** For admins: what the server can see, and when the collector last called. */
export async function SetupCheck() {
  return <Check tick={await lastTick().catch(() => null)} refused={await lastRefusedTick().catch(() => null)}
    failed={await lastTickError().catch(() => null)} mem={await memory()} />;
}

function Check({ tick, refused, failed, mem }: { tick: number | null; refused: number | null; failed: TickError | null; mem: Memory | null }) {
  const mb = (b: number) => (b / 1048576).toFixed(1);
  const full = mem && mem.max ? mem.used / mem.max : null;
  const store = storeSource();
  const related = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/.test(k)).sort();
  const secret = Boolean(process.env.PUSH_TICK_SECRET);
  const ago = tick ? Math.round((Date.now() - tick) / 60000) : null;
  const failedAgo = failed ? Math.round((Date.now() - failed.at) / 60000) : null;
  const recentError = failedAgo !== null && failedAgo <= 60;
  const row = (ok: boolean, label: string, detail: string) => (
    <li className={ok ? "ok" : "missing"}><span aria-hidden="true">{ok ? "✓" : "✗"}</span> <strong>{label}</strong> {detail}</li>
  );
  return (
    <details className="panel setup" open={!store || !secret || ago === null || ago > 15 || recentError || (full ?? 0) > 0.85}>
      <summary>Setup check</summary>
      <ul>
        {row(Boolean(store), "Store", store ? `found (${store}).`
          : related.length ? `not usable. The server sees ${related.join(", ")} but needs a REST URL and token pair, e.g. KV_REST_API_URL and KV_REST_API_TOKEN.`
          : "not found. Connect Upstash for Redis to this Vercel project for Production, then redeploy.")}
        {row(secret, "Tick secret", secret ? "set (PUSH_TICK_SECRET)." : "missing. Add PUSH_TICK_SECRET in Vercel, then redeploy.")}
        {row(ago !== null && ago <= 15, "Collector tick", refused && (!tick || refused > tick)
          ? `a call arrived ${Math.round((Date.now() - refused) / 60000)} min ago with the wrong secret: PUSH_TICK_SECRET in GitHub must match Vercel's exactly.`
          : ago === null ? "not seen yet. In GitHub → Settings → Secrets and variables → Actions, add PUSH_TICK_URL and PUSH_TICK_SECRET (either tab works); the next collector run picks them up and its log says whether each is set."
          : `last seen ${ago} min ago${ago > 15 ? "; the collector may be between runs" : ""}.`)}
        {mem && row((full ?? 0) <= 0.85, "Store space", mem.max
          ? `${mb(mem.used)} of ${mb(mem.max)} MB used (${Math.round(full! * 100)}%).${full! > 0.85 ? " Nearly full: the tick clears old code keys a few pages at a time." : ""}`
          : `${mb(mem.used)} MB used.`)}
        {failed && row(!recentError, "Tick errors", recentError
          ? `the last call ${failedAgo} min ago hit: ${failed.error}`
          : `none in the last hour (the last was ${failedAgo} min ago).`)}
      </ul>
      <p className="status">Environment variables only reach new deployments: after changing them in Vercel, redeploy.</p>
    </details>
  );
}

