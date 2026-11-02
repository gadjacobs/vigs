import { CodesPanel } from "../codes-panel";
import { cookies } from "next/headers";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { viewOf } from "@/lib/view";

export default async function Codes() {
  const { profile } = await myProfile();
  return (
    <main>
      <h1>Codes</h1>
      <CodesPanel stake={profile?.prefs?.stake ?? DEFAULT_STAKE} view={viewOf(profile, (await cookies()).get("vig_view")?.value)} />
    </main>
  );
}
