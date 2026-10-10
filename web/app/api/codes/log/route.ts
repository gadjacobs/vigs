import { range, storeReady } from "@/lib/store";

export const dynamic = "force-dynamic";

// The collector reads booked codes here (PUSH_TICK_SECRET) and appends them to
// the ledger, so the Record page can score the codes people actually book.
export async function GET(request: Request) {
  const secret = process.env.PUSH_TICK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!storeReady()) return Response.json({ entries: [] });
  return Response.json({ entries: await range("codelog", -1000, -1) });
}
