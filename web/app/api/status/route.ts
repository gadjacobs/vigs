import { BUILD } from "@/lib/build";
import { upcoming } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

/** What the update toast compares: this deployment, and the latest published round. */
export async function GET() {
  let round = "";
  try {
    const f = await upcoming();
    round = f.length ? String(Math.max(...f.map((x) => x.kickoff))) : "";
  } catch { /* SportyBet unreachable: leave the round unchanged */ }
  return Response.json({ build: BUILD, round }, { headers: { "Cache-Control": "no-store" } });
}
