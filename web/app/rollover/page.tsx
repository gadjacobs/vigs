import Link from "next/link";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { TabPending } from "../tab-pending";
import { RolloverPanel } from "./rollover-panel";

export const dynamic = "force-dynamic";

export default async function Rollover() {
  const { profile } = await myProfile();
  return (
    <main>
      <h1>Our picks</h1>
      <nav className="pagetabs" aria-label="Our picks">
        <Link href="/picks?tab=cooked">Cooked slips<TabPending /></Link>
        <Link href="/picks?tab=build">Build your own<TabPending /></Link>
        <Link href="/rollover" aria-current="page">Rollover<TabPending /></Link>
      </nav>
      <RolloverPanel defaultStake={profile?.prefs?.stake ?? DEFAULT_STAKE} />
    </main>
  );
}
