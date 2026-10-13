import Link from "next/link";
import { redirect } from "next/navigation";
import { lagos } from "../pick-row";
import { overview, type Person } from "@/lib/activity";
import { isAdmin } from "@/lib/beta";
import { chance } from "@/lib/plain";
import { currentUser } from "@/lib/profile";
import { storeReady } from "@/lib/store";

export const dynamic = "force-dynamic";

const naira = (x: number) => `${x < 0 ? "−" : ""}₦${Math.abs(Math.round(x)).toLocaleString("en-NG")}`;
function ago(t: number | null, now: number) {
  if (!t) return "never";
  const m = Math.round((now - t) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const ORIGIN: Record<string, string> = {
  tonight: "Tonight", ourpicks: "Our picks", cooked: "Cooked", ladder: "Ladder", likelier: "Make it likelier", tracked: "Tracked",
};

function PersonCard({ p, now }: { p: Person; now: number }) {
  const r = p.record;
  return (
    <li className="adm-person">
      <div className="adm-head">
        <span className="avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{p.name}</strong>{p.name !== p.user && <span className="muted"> · {p.user}</span>}
          <small>{p.email ?? "password sign-in"} · seen {ago(p.seen ?? p.lastCode, now)}</small>
        </div>
      </div>
      <dl className="adm-stats">
        <div><dt>Codes (30 days)</dt><dd className="num">{p.codes30}</dd></div>
        <div><dt>Settled</dt><dd className="num">{r?.settled ?? 0}</dd></div>
        <div><dt>Landed</dt><dd className="num">{r ? `${r.landed}` : "0"}<small>{r ? ` of ${r.expected_market.toFixed(1)} expected` : ""}</small></dd></div>
        <div><dt>Est. result</dt><dd className={`num ${p.estNet !== null && p.estNet < 0 ? "loss" : ""}`}>{p.estNet !== null ? naira(p.estNet) : "None"}
          <small>{p.estNet !== null ? ` at ${naira(p.stake)} a code` : ""}</small></dd></div>
      </dl>
      <p className="adm-tags">
        <span>{p.devices ? `Alerts on ${p.devices} device${p.devices > 1 ? "s" : ""}` : "Alerts off"}</span>
        <span>{p.view === "detailed" ? "Rich" : "Simple"} view</span>
        {p.ideas > 0 && <span>{p.ideas} idea{p.ideas > 1 ? "s" : ""}</span>}
        {Object.entries(p.origins).sort((a, b) => b[1] - a[1]).map(([o, n]) => <span key={o}>{ORIGIN[o] ?? o} {n}</span>)}
      </p>
    </li>
  );
}

export default async function Admin() {
  const user = await currentUser();
  if (!user || !isAdmin(user)) redirect("/");
  const now = Date.now();
  if (!storeReady()) return <main><h1>Admin</h1><p className="note">Connect the store to see activity.</p></main>;
  const o = await overview(now);
  return (
    <main className="admin">
      <p><Link href="/account">← Settings</Link></p>
      <h1>Admin</h1>
      <p className="lede">Who uses Vig and how their codes do. Results come from the record ({o.recordAt ? `updated ${lagos(Date.parse(o.recordAt))} Lagos` : "not published yet"}); bookings are live.</p>
      <div className="adm-tiles">
        <div><b className="num">{o.totals.people}</b><span>accounts</span></div>
        <div><b className="num">{o.totals.active7}</b><span>active this week</span></div>
        <div><b className="num">{o.totals.codes7}</b><span>codes this week</span></div>
        <div><b className="num">{o.totals.devices}</b><span>devices with alerts</span></div>
      </div>

      <h2>People</h2>
      <ul className="adm-people">{o.people.map((p) => <PersonCard key={p.user} p={p} now={now} />)}</ul>
      <p className="status">Est. result is the record&apos;s return per code at a flat stake, times settled codes, at each person&apos;s usual stake.
        Vig never sees what anyone actually stakes or wins in SportyBet, so treat it as a guide.</p>

      <h2>Latest codes</h2>
      {!o.recent.length ? <p className="note">No codes booked or tracked yet.</p> : (
        <ol className="adm-feed">
          {o.recent.map((b) => {
            const odds = b.legs.reduce((a, l) => a * (l.odds ?? 1), 1);
            const p = b.legs.every((l) => l.market_prob) ? b.legs.reduce((a, l) => a * (l.market_prob as number), 1) : null;
            return (
              <li key={`${b.code}-${b.booked_at}`}>
                <span className="num muted">{lagos(b.booked_at)}</span>
                <span><strong>{b.user}</strong> · {ORIGIN[b.origin.split(":")[0]] ?? b.origin}<small>{b.code} · {b.legs.length} legs</small></span>
                <span className="num">{odds < 100 ? odds.toFixed(2) : Math.round(odds).toLocaleString("en-NG")}</span>
                <span className="muted">{p !== null ? chance(p) : ""}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="setlinks"><Link className="button" href="/feedback">Ideas and bugs</Link><Link className="button" href="/account#admin">Invites and setup</Link></p>
    </main>
  );
}
