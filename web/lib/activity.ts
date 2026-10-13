import { accounts } from "./auth";
import { ideas, invites } from "./beta";
import { DEFAULT_STAKE, type Profile } from "./profile";
import { loadRecord, type CodeGroup } from "./record";
import { getJson, members, range } from "./store";

// What admins see on /admin: each account's activity, from what the store and the
// published record already hold. Vig never sees real stakes, so returns are
// estimates at each account's usual stake.

export { touchSeen } from "./seen";

export type Booking = { code: string; user: string | null; origin: string; booked_at: number; legs: { odds: number | null; market_prob: number | null; kickoff: number | null }[] };

export type Person = {
  user: string; name: string; email: string | null; seen: number | null; stake: number; view: string;
  devices: number; codes30: number; lastCode: number | null; ideas: number;
  record: Pick<CodeGroup, "codes" | "settled" | "landed" | "expected_market" | "roi"> | null;
  estNet: number | null; // record return per code x settled codes x usual stake
  origins: Record<string, number>;
};

export type Overview = { people: Person[]; recent: Booking[]; recordAt: string | null; totals: { people: number; active7: number; codes7: number; devices: number } };

const googleNames = () => (process.env.GOOGLE_ACCOUNTS ?? "").split(",").map((p) => p.split("=")[1]?.trim().toLowerCase()).filter((x): x is string => Boolean(x));

export async function overview(now = Date.now()): Promise<Overview> {
  const [rec, inv, idea, known, subIds, log] = await Promise.all([
    loadRecord().catch(() => null), invites().catch(() => []), ideas().catch(() => []),
    members("users").catch(() => [] as string[]), members("subs").catch(() => [] as string[]),
    range<Booking>("codelog", -1000, -1).catch(() => [] as Booking[]),
  ]);
  const byUser = rec?.mycodes?.by_user ?? {};
  const subs = await Promise.all(subIds.map((id) => getJson<{ user?: string }>(`sub:${id}`).catch(() => null)));
  const devices: Record<string, number> = {};
  for (const s of subs) if (s?.user) devices[s.user] = (devices[s.user] ?? 0) + 1;

  const names = new Set<string>([
    ...accounts().map((a) => a.name), ...googleNames(), ...inv.map((i) => i.account), ...known,
    ...Object.keys(byUser), ...Object.keys(devices), ...log.flatMap((b) => (b.user && b.user !== "vig" ? [b.user] : [])),
  ].filter((u) => u && u !== "vig"));

  const people = await Promise.all([...names].map(async (user): Promise<Person> => {
    const [p, seen] = await Promise.all([
      getJson<Profile>(`profile:${user}`).catch(() => null), getJson<number>(`seen:${user}`).catch(() => null),
    ]);
    const g = byUser[user] ?? null;
    const stake = p?.prefs?.stake ?? DEFAULT_STAKE;
    const mine = log.filter((b) => b.user === user);
    const origins: Record<string, number> = {};
    for (const b of mine) { const o = b.origin.split(":")[0]; origins[o] = (origins[o] ?? 0) + 1; }
    const codes = p?.codes ?? [];
    return {
      user, name: p?.prefs?.name || p?.who?.name || user, email: p?.who?.email ?? inv.find((i) => i.account === user)?.email ?? null,
      seen: seen ?? null, stake, view: p?.view ?? "simple", devices: devices[user] ?? 0,
      codes30: codes.length, lastCode: codes.length ? Math.max(...codes.map((c) => c.at)) : mine.at(-1)?.booked_at ?? null,
      ideas: idea.filter((i) => i.by === user).length,
      record: g && { codes: g.codes, settled: g.settled, landed: g.landed, expected_market: g.expected_market, roi: g.roi },
      estNet: g && g.settled ? g.roi * g.settled * stake : null,
      origins,
    };
  }));
  people.sort((a, b) => (b.seen ?? b.lastCode ?? 0) - (a.seen ?? a.lastCode ?? 0));
  const week = now - 7 * 86_400_000;
  return {
    people,
    recent: log.filter((b) => b.user && b.user !== "vig").slice(-40).reverse(),
    recordAt: rec?.generated_at ?? null,
    totals: {
      people: people.length,
      active7: people.filter((p) => (p.seen ?? p.lastCode ?? 0) > week).length,
      codes7: log.filter((b) => b.user && b.user !== "vig" && b.booked_at > week).length,
      devices: Object.values(devices).reduce((a, n) => a + n, 0),
    },
  };
}
