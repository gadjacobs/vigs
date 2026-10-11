import { CodesPanel } from "../codes-panel";
import { cookies } from "next/headers";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { viewOf } from "@/lib/view";

export default async function Codes() {
  const { profile } = await myProfile();
  return (
    <main>
      <h1>Codes</h1>
      <p className="lede">Every code you book, on any device signed in to your account. Scores and the chance each code lands update live while it plays.</p>
      <CodesPanel stake={profile?.prefs?.stake ?? DEFAULT_STAKE} view={viewOf(profile, (await cookies()).get("vig_view")?.value)} />
    </main>
  );
}
