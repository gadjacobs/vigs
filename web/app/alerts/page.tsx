import { cookies } from "next/headers";
import { AlertsPanel } from "./alerts-panel";
import { SHORT_LABELS } from "@/lib/markets";
import { pushReady, vapidPublicKey } from "@/lib/push";
import { parseQuery } from "@/lib/query";

export const dynamic = "force-dynamic";

export default async function Alerts() {
  const saved = (await cookies()).get("vig_q")?.value;
  const q = parseQuery(saved ? Object.fromEntries(new URLSearchParams(decodeURIComponent(saved))) : {});
  const filters = `${q.mode === "target" ? `total odds ${q.target} (±${Math.round(q.tol * 100)}%)` : `${q.count} picks`}, ` +
    `${q.markets.map((m) => SHORT_LABELS[m] ?? m).join(", ")}, next ${q.hours} h, ${q.minGrade} or better`;
  return (
    <main>
      <h1>Alerts</h1>
      <p className="lede">Notifications on this device: when a booked code lands or loses, and a tip slip at times you choose.</p>
      {!pushReady() ? (
        <p className="note warn" role="alert">
          Notifications are not set up on the server yet. They need a small store (Upstash Redis) and a tick secret; see the README section
          &ldquo;Notifications&rdquo;.
        </p>
      ) : (
        <AlertsPanel vapidKey={await vapidPublicKey()} filters={filters} />
      )}
      <p className="status" style={{ marginTop: 24 }}>
        Tips are the slip the Tonight page would build with your last filters, priced live. They are estimates, not
        promises. Vig never places bets.
      </p>
    </main>
  );
}
