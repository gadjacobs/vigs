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

type Outcome = { desc?: string; odds?: string; probability?: string; isActive?: number };
type Market = { id?: string | number; specifier?: string | null; status?: number | string; outcomes?: Outcome[] };
export type ApiEvent = {
  eventId: string;
  estimateStartTime: number | string;
  homeTeamName: string;
  awayTeamName: string;
  sport: { category: { name: string } };
  markets?: Market[];
  matchStatus?: string; // in play: "H1", "HT", "H2"; then "End"
  playedSeconds?: string; // match clock, "61:00"
  setScore?: string;
  gameScore?: string[]; // [first half, second half]
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers }, cache: "no-store" });
  if (!res.ok) throw new Error(`SportyBet HTTP ${res.status}`);
  const body = (await res.json()) as { bizCode?: number; message?: string; data?: T };
  if (body.bizCode !== 10000) throw new Error(`SportyBet: ${body.message ?? body.bizCode}`);
  return body.data as T;
}

/** Map SportyBet markets to vigs keys; a group is kept only if every outcome is active.
 * With field "probability", SportyBet's own probability per outcome instead. Double
 * chance (DC1X, DC12, DCX2) is only offered on the single-event feed. */
export function parseOdds(e: Partial<ApiEvent>, field: "odds" | "probability" = "odds", anyStatus = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of e.markets ?? []) {
    // anyStatus: keep SportyBet's probability even while a market is paused or
    // one outcome is closed (a 3-0 lead closes the away win), for live chances.
    if (!anyStatus && String(m.status ?? 0) !== "0") continue;
    const outs = m.outcomes ?? [];
    if (!outs.length || (!anyStatus && outs.some((o) => !o.isActive))) continue;
    const prices: Record<string, number> = {};
    for (const o of outs) if (o.desc && o[field]) prices[o.desc] = Number(o[field]);
    const id = String(m.id);
    const spec = m.specifier ?? "";
    if (id === "1" && prices.Home && prices.Draw && prices.Away) {
      Object.assign(out, { "1": prices.Home, X: prices.Draw, "2": prices.Away });
    } else if (id === "10" && prices["Home or Draw"] && prices["Home or Away"] && prices["Draw or Away"]) {
      Object.assign(out, { DC1X: prices["Home or Draw"], DC12: prices["Home or Away"], DCX2: prices["Draw or Away"] });
    } else if (id === "29" && prices.Yes && prices.No) {
      Object.assign(out, { BY: prices.Yes, BN: prices.No });
    } else if ((id === "18" || id === "68") && /^total=\d\.\d$/.test(spec)) {
      const line = spec.slice(6);
      const key = line.replace(".", "");
      const pre = id === "68" ? "FH_" : "";
      const over = prices[`Over ${line}`];
      const under = prices[`Under ${line}`];
      if (field === "probability" ? over > 0 && under > 0 : over > 1 && under > 1) {
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

/** A match in play, as the live feed shows it. */
export type LiveEvent = {
  eventId: string; phase: string; minute: number | null;
  score: [number, number] | null; fh: [number, number] | null;
  odds: Record<string, number>; prob: Record<string, number>;
};

const pair = (s: unknown): [number, number] | null => {
  const m = /^(\d+):(\d+)$/.exec(String(s ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
};

export function parseLive(e: ApiEvent): LiveEvent {
  const clock = /^(\d+):/.exec(e.playedSeconds ?? "");
  return {
    eventId: e.eventId, phase: e.matchStatus ?? "", minute: clock ? Number(clock[1]) : null,
    score: pair(e.setScore), fh: pair(e.gameScore?.[0]),
    odds: parseOdds(e), prob: parseOdds(e, "probability", true),
  };
}

let boardCache: { at: number; data: Map<string, LiveEvent> } | null = null;

/** Every match in play (1X2 and totals only). SportyBet reprices about every
 * 13 seconds, so 8 seconds of caching loses nothing. */
export async function liveBoard(): Promise<Map<string, LiveEvent>> {
  if (boardCache && Date.now() - boardCache.at < 8_000) return boardCache.data;
  const data = await call<{ events?: ApiEvent[] }[]>(`${BASE}/liveOrPrematchEvents?sportId=${SPORT}`);
  const map = new Map((data ?? []).flatMap((t) => t.events ?? []).map((e) => [e.eventId, parseLive(e)]));
  boardCache = { at: Date.now(), data: map };
  return map;
}

const eventCache = new Map<string, { at: number; data: LiveEvent | null }>();

/** One match with every market (first half, both teams score, double chance).
 * live: in play (productId 1); otherwise before kickoff (productId 3). */
export async function eventMarkets(eventId: string, live: boolean): Promise<LiveEvent | null> {
  const key = `${eventId}|${live}`;
  const hit = eventCache.get(key);
  if (hit && Date.now() - hit.at < (live ? 8_000 : 30_000)) return hit.data;
  const q = new URLSearchParams({ eventId, productId: live ? "1" : "3" });
  const e = await call<ApiEvent | null>(`${BASE}/event?${q}`).catch(() => null);
  const data = e?.eventId ? parseLive(e) : null;
  if (eventCache.size > 300) eventCache.clear();
  eventCache.set(key, { at: Date.now(), data });
  return data;
}

export type Selection = { eventId: string; marketId: string; specifier: string | null; outcomeId: string };

export function selection(market: string, eventId: string): Selection {
  if (market.startsWith("DC"))
    return { eventId, marketId: "10", specifier: null, outcomeId: { DC1X: "9", DC12: "10", DCX2: "11" }[market] ?? "" };
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
