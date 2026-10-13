import Link from "next/link";
import { cookies } from "next/headers";
import { logout } from "../actions";
import { ThemeToggle } from "../theme-toggle";
import { AlertsPanel } from "../alerts/alerts-panel";
import { SetupCheck } from "../alerts/setup-check";
import { SavedFilters, SettingsForm } from "./account-form";
import { Invites } from "./invites";
import { invites, isAdmin } from "@/lib/beta";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { pushReady, vapidPublicKey } from "@/lib/push";
import { parseQuery } from "@/lib/query";
import { SHORT_LABELS } from "@/lib/markets";
import { storeSource } from "@/lib/store";
import { viewOf } from "@/lib/view";

export const dynamic = "force-dynamic";

const SECTIONS = [["display", "Display"], ["defaults", "Defaults"], ["alerts", "Notifications"], ["filters", "Filters"], ["help", "Help"]] as const;

export default async function Settings() {
  const { user, profile } = await myProfile();
  const jar = await cookies();
  const p = profile?.prefs ?? {};
  const synced = Boolean(storeSource());
  const admin = isAdmin(user);
  const saved = profile?.query ?? decodeURIComponent(jar.get("vig_q")?.value ?? "");
  const q = parseQuery(saved ? Object.fromEntries(new URLSearchParams(saved)) : {});
  const filters = `${q.mode === "target" ? `total odds ${q.target}` : `${q.count} picks`}, ${q.markets.map((m) => SHORT_LABELS[m] ?? m).join(", ")}`;
  return (
    <main className="settings">
      <div className="acct-hero">
        {profile?.who?.picture
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={profile.who.picture} alt="" className="avatar big" referrerPolicy="no-referrer" />
          : <span className="avatar big" aria-hidden="true">{(p.name || user || "?").slice(0, 1).toUpperCase()}</span>}
        <div>
          <h1>Settings</h1>
          <p className="status">
            {p.name || user} · {profile?.who ? profile.who.email : `account ${user}`}.{" "}
            {synced ? "Everything here follows you to every device." : ""}
          </p>
        </div>
      </div>
      <nav className="setindex" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        {admin && <a href="#admin">Admin</a>}
      </nav>

      {synced && <SettingsForm view={viewOf(profile, jar.get("vig_view")?.value)}
        initial={{ name: p.name ?? "", stake: p.stake ?? DEFAULT_STAKE, home: p.home ?? "/" }} />}
      <section className="setcard" aria-labelledby="theme-h">
        <h2 id="theme-h">Theme</h2>
        <ThemeToggle initial={profile?.theme ?? jar.get("vig_theme")?.value ?? "system"} />
      </section>

      <section id="alerts" className="setcard" aria-labelledby="alerts-h">
        <h2 id="alerts-h">Notifications</h2>
        <p className="status">For this device. Each phone or laptop you use has its own.</p>
        {pushReady() ? <AlertsPanel vapidKey={await vapidPublicKey()} filters={filters} /> : <p className="note">Notifications aren&apos;t available right now.</p>}
      </section>

      {synced && <SavedFilters initial={profile?.filters ?? []} />}

      <section id="help" className="setcard" aria-labelledby="help-h">
        <h2 id="help-h">Help</h2>
        <div className="setlinks">
          <Link href="/onboarding?again=1" className="button">Replay the tour</Link>
          <Link href="/welcome" className="button">What Vig does</Link>
          <Link href="/feedback" className="button">Ideas and bugs</Link>
          <Link href="/record?tab=yours" className="button">Your record</Link>
        </div>
        <p className="status">Privacy: Vig&apos;s admins can see which codes your account books or tracks, how they did, and when you last used the app, to improve Vig. They never see SportyBet details or what you stake.</p>
      </section>

      {admin && (
        <section id="admin" className="setcard" aria-labelledby="admin-h">
          <h2 id="admin-h">Admin</h2>
          <p><Link href="/admin" className="button primary">Open the admin page</Link></p>
          {synced && <Invites list={await invites().catch(() => [])} />}
          <SetupCheck />
        </section>
      )}

      <form action={logout} className="signout"><button type="submit" className="danger-ghost">Sign out</button></form>
    </main>
  );
}
