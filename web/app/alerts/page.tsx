import { cookies } from "next/headers";
import { AlertsPanel } from "./alerts-panel";
import { SHORT_LABELS } from "@/lib/markets";
import { lastRefusedTick, lastTick, pushReady, vapidPublicKey } from "@/lib/push";
import { storeSource } from "@/lib/store";
import { myProfile } from "@/lib/profile";
import { parseQuery } from "@/lib/query";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

function SetupCheck({ tick, refused }: { tick: number | null; refused: number | null }) {
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

export default async function Alerts() {
  const { user, profile } = await myProfile();
  const saved = profile?.query ?? decodeURIComponent((await cookies()).get("vig_q")?.value ?? "");
  const q = parseQuery(saved ? Object.fromEntries(new URLSearchParams(saved)) : {});
  const filters = `${q.mode === "target" ? `total odds ${q.target} (±${Math.round(q.tol * 100)}%)` : `${q.count} picks`}, ` +
    `${q.markets.map((m) => SHORT_LABELS[m] ?? m).join(", ")}, next ${q.hours} h, ${q.minGrade} or better`;
  return (
    <main>
      <h1>Alerts</h1>
      <p className="lede">Notifications on this device: when a booked code lands or loses, and a tip slip at times you choose.</p>
      <SetupCheck tick={await lastTick().catch(() => null)} refused={await lastRefusedTick().catch(() => null)} />
      {!pushReady() ? (
        <p className="note warn" role="alert">
          Notifications need the store. The setup check above shows what the server can see.
        </p>
      ) : (
        <AlertsPanel vapidKey={await vapidPublicKey()} filters={filters} />
      )}
      <section className="panel account" aria-labelledby="acct">
        <h2 id="acct">Account</h2>
        <p className="status">
          Signed in as <strong>{user}</strong>{profile?.who ? ` with Google (${profile.who.email})` : ""}.{" "}
          {storeSource() ? "Booked codes, filters, view and theme sync across every device signed in to this account."
            : "Syncing across devices needs the store (see the setup check)."}
        </p>
        <form action={logout}><button type="submit">Sign out</button></form>
      </section>

      <p className="status" style={{ marginTop: 24 }}>
        Tips are the slip the Tonight page would build with your last filters, priced live. They are estimates, not
        promises. Vig never places bets.
      </p>
    </main>
  );
}
