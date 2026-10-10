import { CodesPanel } from "../codes-panel";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";

export default async function Codes() {
  const { profile } = await myProfile();
  return (
    <main>
      <h1>Codes</h1>
      <p className="lede">Every code you book, on any device signed in to your account. Scores and the chance each code lands update live while it plays.</p>
      <CodesPanel stake={profile?.prefs?.stake ?? DEFAULT_STAKE} />
    </main>
  );
}
