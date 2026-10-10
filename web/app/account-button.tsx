import Link from "next/link";
import { myProfile } from "@/lib/profile";

/** Top-right avatar: the way into Account. Hidden when nobody is signed in. */
export async function AccountButton() {
  const { user, profile } = await myProfile().catch(() => ({ user: null, profile: null }));
  if (!user) return null;
  const label = profile?.prefs?.name || user;
  return (
    <Link href="/account" className="avatar" aria-label={`Account: ${label}`} title={label}>
      {profile?.who?.picture
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={profile.who.picture} alt="" referrerPolicy="no-referrer" />
        : label.slice(0, 1).toUpperCase()}
    </Link>
  );
}
