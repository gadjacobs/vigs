import { cookies } from "next/headers";
import Link from "next/link";
import { SlipBuilder } from "../../slip-builder";
import { loadBlend } from "@/lib/blend";
import { currentSlates } from "@/lib/kitchen";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel } from "@/lib/model";
import { candidates } from "@/lib/picks";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { DEFAULT_QUERY, type Query } from "@/lib/query";
import { upcoming } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

export default async function EditSlate({ searchParams }: { searchParams: Promise<{ slate?: string }> }) {
  const { slate: id } = await searchParams;
  const now = Date.now();
  const cooked = await currentSlates(now).catch(() => null);
  const slate = cooked?.slates.find((s) => s.id === id);
  const { profile } = await myProfile();
  const view = (profile?.view ?? (await cookies()).get("vig_view")?.value) === "detailed" ? "detailed" : "simple";
  const [model, fixtures, blend] = await Promise.all([loadModel(), upcoming(), loadBlend()]);
  const q: Query = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 4, mode: "count", count: 30, sort: "likely" };
  const cands = candidates(model, fixtures, { ...q, now }, blend).candidates;
  const have = new Set(cands.map((p) => p.id));
  const ids = slate ? slate.legs.map((p) => p.id).filter((x) => have.has(x)) : [];
  return (
    <main>
      <p><Link href="/picks">← Our picks</Link></p>
      <h1>{slate ? `Edit: ${slate.name}` : "Slip not found"}</h1>
      {!slate ? (
        <p className="note">This slip has been recooked for a newer round. Pick one from <Link href="/picks">Our picks</Link>.</p>
      ) : (
        <>
          <p className="lede">
            Remove legs, switch them, or add any other selection below, then book your own code.
            {ids.length < slate.legs.length ? ` ${slate.legs.length - ids.length} leg(s) have kicked off and were left out.` : ""}
          </p>
          <SlipBuilder key={now} cands={cands} q={q} now={now} initialView={view} initialIds={ids}
            title={slate.name} flex={slate.style === "draws"} stake={profile?.prefs?.stake ?? DEFAULT_STAKE} />
        </>
      )}
    </main>
  );
}
