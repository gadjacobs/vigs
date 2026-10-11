import { lastRefusedTick, lastTick } from "@/lib/push";
import { storeSource } from "@/lib/store";

/** For admins: what the server can see, and when the collector last called. */
export async function SetupCheck() {
  return <Check tick={await lastTick().catch(() => null)} refused={await lastRefusedTick().catch(() => null)} />;
}

function Check({ tick, refused }: { tick: number | null; refused: number | null }) {
  const store = storeSource();
  const related = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/.test(k)).sort();
  const secret = Boolean(process.env.PUSH_TICK_SECRET);
  const ago = tick ? Math.round((Date.now() - tick) / 60000) : null;
  const row = (ok: boolean, label: string, detail: string) => (
    <li className={ok ? "ok" : "missing"}><span aria-hidden="true">{ok ? "✓" : "✗"}</span> <strong>{label}</strong> {detail}</li>
  );
  return (
    <details className="panel setup" open={!store || !secret || ago === null || ago > 15}>
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
      </ul>
      <p className="status">Environment variables only reach new deployments: after changing them in Vercel, redeploy.</p>
    </details>
  );
}

