import { cookies } from "next/headers";
import { AlertsPanel } from "./alerts-panel";
import { SHORT_LABELS } from "@/lib/markets";
import { pushReady, vapidPublicKey } from "@/lib/push";
import { isAdmin } from "@/lib/beta";
import { SetupCheck } from "./setup-check";
import { storeSource } from "@/lib/store";
import { myProfile } from "@/lib/profile";
import { parseQuery } from "@/lib/query";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function Alerts() {
  const { user, profile } = await myProfile();
  const saved = profile?.query ?? decodeURIComponent((await cookies()).get("vig_q")?.value ?? "");
  const q = parseQuery(saved ? Object.fromEntries(new URLSearchParams(saved)) : {});
  const filters = `${q.mode === "target" ? `total odds ${q.target} (±${Math.round(q.tol * 100)}%)` : `${q.count} picks`}, ` +
    `${q.markets.map((m) => SHORT_LABELS[m] ?? m).join(", ")}, next ${q.hours} h, ${q.minGrade} or better`;
  return (
    <main>
      <h1>Alerts</h1>
      <p className="lede">Notifications on this device: your codes as they play, tip slips at times you choose, and Our picks on a schedule.</p>
      {isAdmin(user) && <SetupCheck />}
      {!pushReady() ? (
        <p className="note warn" role="alert">
          Notifications aren&apos;t available right now. Try again later.
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
