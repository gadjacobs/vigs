// SportyBet's public web API (see docs/feed-schema.md). Personal use, light traffic.
const BASE = "https://www.sportybet.com/api/ng/factsCenter";
const ORDERS = "https://www.sportybet.com/api/ng/orders";
const SPORT = "sr:sport:202120001"; // vFootball
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.sportybet.com/ng/sport/vFootball",
  OperId: "2",
};

export type Fixture = {
  eventId: string;
  league: string;
  home: string;
  away: string;
  kickoff: number; // ms UTC
  odds: Record<string, number>;
};

type Outcome = { desc?: string; odds?: string; isActive?: number };
type Market = { id?: string | number; specifier?: string | null; status?: number | string; outcomes?: Outcome[] };
type ApiEvent = {
  eventId: string;
  estimateStartTime: number | string;
  homeTeamName: string;
  awayTeamName: string;
  sport: { category: { name: string } };
  markets?: Market[];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers }, cache: "no-store" });
  if (!res.ok) throw new Error(`SportyBet HTTP ${res.status}`);
  const body = (await res.json()) as { bizCode?: number; message?: string; data?: T };
  if (body.bizCode !== 10000) throw new Error(`SportyBet: ${body.message ?? body.bizCode}`);
  return body.data as T;
}

/** Map SportyBet markets to vigs keys; a group is kept only if every outcome is active. */
export function parseOdds(e: ApiEvent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of e.markets ?? []) {
    if (String(m.status ?? 0) !== "0") continue;
    const outs = m.outcomes ?? [];
    if (!outs.length || outs.some((o) => !o.isActive)) continue;
    const prices: Record<string, number> = {};
    for (const o of outs) if (o.desc && o.odds) prices[o.desc] = Number(o.odds);
    const id = String(m.id);
    const spec = m.specifier ?? "";
    if (id === "1" && prices.Home && prices.Draw && prices.Away) {
      Object.assign(out, { "1": prices.Home, X: prices.Draw, "2": prices.Away });
    } else if (id === "29" && prices.Yes && prices.No) {
      Object.assign(out, { BY: prices.Yes, BN: prices.No });
    } else if ((id === "18" || id === "68") && /^total=\d\.\d$/.test(spec)) {
      const line = spec.slice(6);
      const key = line.replace(".", "");
      const pre = id === "68" ? "FH_" : "";
      const over = prices[`Over ${line}`];
      const under = prices[`Under ${line}`];
      if (over > 1 && under > 1) {
        out[`${pre}O${key}`] = over;
        out[`${pre}U${key}`] = under;
      }
    }
  }
  return out;
}

let upcomingCache: { at: number; data: Fixture[] } | null = null;

/** Published fixtures with odds. Odds don't move before kickoff, so 30 s of caching is safe. */
export async function upcoming(): Promise<Fixture[]> {
  if (upcomingCache && Date.now() - upcomingCache.at < 30_000) return upcomingCache.data;
  const data = await fetchUpcoming();
  upcomingCache = { at: Date.now(), data };
  return data;
}

async function fetchUpcoming(): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (let page = 1; page < 10; page++) {
    const q = new URLSearchParams({
      sportId: SPORT, marketId: "1,18,68,29", pageSize: "100", pageNum: String(page), option: "1",
    });
    const data = await call<{ totalNum?: number; tournaments?: { events: ApiEvent[] }[] }>(
      `${BASE}/pcUpcomingEvents?${q}`,
    );
    const events = (data.tournaments ?? []).flatMap((t) => t.events);
    for (const e of events) {
      out.push({
        eventId: e.eventId,
        league: e.sport.category.name,
        home: e.homeTeamName,
        away: e.awayTeamName,
        kickoff: Number(e.estimateStartTime),
        odds: parseOdds(e),
      });
    }
    if (!events.length || page * 100 >= Number(data.totalNum ?? 0)) break;
  }
  return out;
}

export type Selection = { eventId: string; marketId: string; specifier: string | null; outcomeId: string };

export function selection(market: string, eventId: string): Selection {
  if (market === "1" || market === "X" || market === "2")
    return { eventId, marketId: "1", specifier: null, outcomeId: { "1": "1", X: "2", "2": "3" }[market] };
  if (market === "BY" || market === "BN")
    return { eventId, marketId: "29", specifier: null, outcomeId: market === "BY" ? "74" : "76" };
  const fh = market.startsWith("FH_");
  const key = fh ? market.slice(3) : market;
  return {
    eventId,
    marketId: fh ? "68" : "18",
    specifier: `total=${key[1]}.${key[2]}`,
    outcomeId: key[0] === "O" ? "12" : "13",
  };
}

/** Create a booking code (no login, no stake) and read it back to verify.
 * `deadline` is SportyBet's code expiry: the last kickoff plus 24 hours. */
export async function book(selections: Selection[]): Promise<{ code: string; verified: number; deadline: number }> {
  const created = await call<{ shareCode?: string }>(`${ORDERS}/share`, {
    method: "POST",
    body: JSON.stringify({ selections }),
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
  const code = created.shareCode;
  if (!code) throw new Error("SportyBet returned no booking code");
  const back = await call<{ outcomes?: { eventId: string }[]; deadline?: number }>(`${ORDERS}/share/${code}`);
  const want = new Set(selections.map((s) => s.eventId));
  const verified = (back.outcomes ?? []).filter((o) => want.has(o.eventId)).length;
  return { code, verified, deadline: Number(back.deadline ?? 0) };
}

export type ShareEvent = {
  eventId: string; estimateStartTime: number | string; homeTeamName: string; awayTeamName: string;
  matchStatus?: string; setScore?: string; gameScore?: string[]; regularTimeScore?: string[];
  sport?: { category?: { name?: string } };
  markets?: { id: string | number; specifier?: string | null; desc?: string;
    outcomes?: { id: string | number; odds?: string; desc?: string; isWinning?: number }[] }[];
};

/** A booking code's selections, with each match's status and score once played. */
export async function decodeShare(code: string) {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new Error("That is not a booking code");
  return call<{ outcomes?: ShareEvent[]; deadline?: number; unavailableOutcomes?: unknown[] }>(`${ORDERS}/share/${code}`);
}
