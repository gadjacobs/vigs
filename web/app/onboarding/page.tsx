import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Onboarding } from "./tour";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { pushReady, vapidPublicKey } from "@/lib/push";
import { viewOf } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { user, profile } = await myProfile();
  if (!user) redirect("/login");
  const p = profile?.prefs ?? {};
  return (
    <Onboarding name={p.name || profile?.who?.name?.split(" ")[0] || ""}
      view={viewOf(profile, (await cookies()).get("vig_view")?.value)}
      stake={p.stake ?? DEFAULT_STAKE}
      vapidKey={pushReady() ? await vapidPublicKey() : null}
      home={p.home ?? "/"} />
  );
}
