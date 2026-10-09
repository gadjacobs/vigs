import { MARKET_LABELS } from "./markets";

// The page's filters, shared by the server page and the client filter panel.
export type Query = {
  markets: string[];
  hours: number;
  minOdds: number; // per leg
  maxOdds: number;
  mode: "target" | "count";
  target: number; // total odds
  tol: number; // ± fraction
  maxLegs: number; // 0 = any
  count: number;
  sort: "likely" | "edge";
  minGrade: "Rough" | "Lean";
  minConf: "Low" | "Medium" | "High"; // Low = any
  minChance: number; // per leg, 0 = any
};

export const DEFAULT_QUERY: Query = {
  markets: ["FH_O05", "O15"], hours: 2, minOdds: 1.01, maxOdds: 100, mode: "target", target: 5, tol: 0.1,
  maxLegs: 0, count: 10, sort: "likely", minGrade: "Rough",
  minConf: "Low", minChance: 0,
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(","));
const num = (v: string | undefined, d: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : d;
};

export function parseQuery(sp: Params): Query {
  const d = DEFAULT_QUERY;
  const markets = many(sp.market).filter((m) => m in MARKET_LABELS);
  return {
    markets: markets.length ? markets : d.markets,
    hours: num(one(sp.hours), d.hours, 0.5, 4),
    minOdds: num(one(sp.min), d.minOdds, 1.01, 100),
    maxOdds: num(one(sp.max), d.maxOdds, 1.01, 1000),
    mode: one(sp.mode) === "count" ? "count" : "target",
    target: num(one(sp.target), d.target, 1.1, 10000),
    tol: num(one(sp.tol), d.tol, 0.02, 0.5),
    maxLegs: Math.round(num(one(sp.legs), d.maxLegs, 0, 30)),
    count: Math.round(num(one(sp.count), d.count, 1, 30)),
    sort: one(sp.sort) === "edge" ? "edge" : "likely",
    minGrade: one(sp.grade) === "lean" ? "Lean" : "Rough",
    minConf: one(sp.conf) === "high" ? "High" : one(sp.conf) === "medium" ? "Medium" : "Low",
    minChance: num(one(sp.chance), 0, 0, 95) / 100,
  };
}

export function queryString(q: Query): string {
  const p = new URLSearchParams();
  p.set("market", q.markets.join(","));
  p.set("hours", String(q.hours));
  p.set("mode", q.mode);
  if (q.mode === "target") {
    p.set("target", String(q.target));
    p.set("tol", String(q.tol));
    if (q.maxLegs) p.set("legs", String(q.maxLegs));
  } else {
    p.set("count", String(q.count));
    p.set("sort", q.sort);
  }
  if (q.minOdds > 1.01) p.set("min", String(q.minOdds));
  if (q.maxOdds < 100) p.set("max", String(q.maxOdds));
  if (q.minGrade === "Lean") p.set("grade", "lean");
  if (q.minConf !== "Low") p.set("conf", q.minConf.toLowerCase());
  if (q.minChance > 0) p.set("chance", String(Math.round(q.minChance * 100)));
  return p.toString();
}
