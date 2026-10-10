import Link from "next/link";
import { logout } from "../actions";
import { AccountForm } from "./account-form";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { storeSource } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Account() {
  const { user, profile } = await myProfile();
  const p = profile?.prefs ?? {};
  const synced = Boolean(storeSource());
  return (
    <main>
      <div className="acct-hero">
        {profile?.who?.picture
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={profile.who.picture} alt="" className="avatar big" referrerPolicy="no-referrer" />
          : <span className="avatar big" aria-hidden="true">{(p.name || user || "?").slice(0, 1).toUpperCase()}</span>}
        <div>
          <h1>{p.name || user}</h1>
          <p className="status">
            {profile?.who ? `Signed in with Google (${profile.who.email})` : `Signed in as ${user}`}.{" "}
            {synced ? "Settings, codes, filters, view and theme follow you to every device." : "Syncing needs the store (see Alerts, Setup check)."}
          </p>
        </div>
      </div>
      {synced && <AccountForm initial={{ name: p.name ?? "", stake: p.stake ?? DEFAULT_STAKE, home: p.home ?? "/" }} filters={profile?.filters ?? []} />}
      <section className="panel acct-links">
        <Link className="button" href="/alerts">Notifications</Link>
        <Link className="button" href="/record?tab=yours">Your record</Link>
        <form action={logout}><button type="submit" className="danger-ghost">Sign out</button></form>
      </section>
    </main>
  );
}
