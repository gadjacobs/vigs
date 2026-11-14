import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";

// A share card for a rollover: the pot, the climb from start to target with its
// ×10 milestones, and a chip per step. The page sends the run as `d` (base64url
// JSON), so nothing about it needs storing. Signed-in only (proxy.ts).

const C = { ground: "#0c2a20", paper: "#133629", ink: "#eef3ea", muted: "#a8bdb0", signal: "#f6c945", won: "#8fb8f0", lost: "#ff8a7a", rule: "#28503f" };
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" }[]> | null = null;
const loadFonts = () => (fonts ??= Promise.all([
  ["Num", "big-shoulders-display-latin-800-normal.woff", 800],
  ["Text", "atkinson-hyperlegible-latin-400-normal.woff", 400],
  ["Text", "atkinson-hyperlegible-latin-700-normal.woff", 700],
].map(async ([name, file, weight]) => ({
  name: name as string, data: await readFile(join(process.cwd(), "assets/fonts", file as string)),
  weight: weight as 400 | 700 | 800, style: "normal" as const,
}))));

type Card = { s: "running" | "reached" | "lost" | "banked"; a: number; p: number; t: number; b: number; k: number; st: [number, "w" | "l" | "o"][] };

function parse(d: string | null): Card | null {
  if (!d || d.length > 6000) return null;
  try {
    const j = JSON.parse(Buffer.from(d, "base64url").toString("utf8")) as Card;
    const ok = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 1e12;
    if (!["running", "reached", "lost", "banked"].includes(j.s) || ![j.a, j.p, j.t, j.b, j.k].every(ok) || !(j.t > j.a)) return null;
    if (!Array.isArray(j.st) || j.st.length > 120) return null;
    return { ...j, st: j.st.filter((x) => Array.isArray(x) && ok(x[0]) && ["w", "l", "o"].includes(x[1])) };
  } catch { return null; }
}

// The card's fonts have no naira sign, so it is drawn: an N with two bars.
function Naira({ size, color, weight = 0.11 }: { size: number; color: string; weight?: number }) {
  const w = size * 0.62, sw = size * weight;
  return (
    <svg width={w} height={size * 0.78} viewBox="0 0 62 78" style={{ marginRight: size * 0.04 }}>
      <path d="M10 74V4L52 74V4" fill="none" stroke={color} strokeWidth={sw * (78 / (size * 0.78))} strokeLinejoin="miter" />
      <path d="M2 30H60M2 48H60" fill="none" stroke={color} strokeWidth={sw * 0.7 * (78 / (size * 0.78))} />
    </svg>
  );
}
const num = (x: number) => Math.round(x).toLocaleString("en-NG");
const shortNum = (x: number) => x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace(/\.0$/, "")}m` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : num(x);
/** An amount with the drawn naira sign, inline with text of `size` px. */
const Amt = ({ x, size, color, short = false, weight }: { x: number; size: number; color: string; short?: boolean; weight?: number }) => (
  <div style={{ display: "flex", alignItems: "center" }}><Naira size={size} color={color} weight={weight} />{short ? shortNum(x) : num(x)}</div>
);
const at = (a: number, x: number, t: number) => (x <= a ? 0 : x >= t ? 1 : Math.log(x / a) / Math.log(t / a));

export async function GET(request: Request) {
  const c = parse(new URL(request.url).searchParams.get("d"));
  if (!c) return new Response("Not a rollover", { status: 400 });
  const landed = c.st.filter(([, x]) => x === "w").length;
  const shown = c.s === "lost" ? c.b : c.p + c.k;
  const head = c.s === "reached" ? "Target reached" : c.s === "banked" ? "Banked" : c.s === "lost" ? "Ran to" : c.k > 0 ? "Worth now, pot and set aside" : "Pot now";
  const ms: number[] = [];
  for (let m = c.a * 10; m < c.t; m *= 10) ms.push(m);
  const W = 1080, track = 920;
  const fill = at(c.a, c.s === "lost" ? c.b : c.p + c.k, c.t);
  const chips = c.st.slice(-24);
  return new ImageResponse(
    <div style={{ width: W, height: W, display: "flex", flexDirection: "column", padding: 80, color: C.ink, fontFamily: "Text",
      background: `radial-gradient(900px 600px at 100% 0%, rgba(246,201,69,0.30), transparent 60%), linear-gradient(160deg, #164a37, ${C.ground})` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 6, color: C.muted }}>ROLLOVER</div>
        <div style={{ display: "flex", fontFamily: "Num", fontWeight: 800, fontSize: 56 }}>Vig</div>
      </div>
      <div style={{ display: "flex", marginTop: 60, fontSize: 34, color: C.muted }}>{head}</div>
      <div style={{ display: "flex", fontFamily: "Num", fontWeight: 800, fontSize: 190, lineHeight: 1, color: c.s === "lost" ? C.ink : C.signal }}>
        <Amt x={shown} size={150} color={c.s === "lost" ? C.ink : C.signal} weight={0.13} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, fontSize: 34 }}>
        {`${landed} step${landed === 1 ? "" : "s"} landed · started`}<Amt x={c.a} size={30} color={C.ink} short />{"· aim"}<Amt x={c.t} size={30} color={C.ink} short />
      </div>
      {c.k > 0 && <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 30, color: C.won }}><Amt x={c.k} size={26} color={C.won} />set aside along the way</div>}
      <div style={{ display: "flex", position: "relative", width: track, height: 120, marginTop: 70 }}>
        <div style={{ display: "flex", position: "absolute", left: 0, top: 22, width: track, height: 20, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
        <div style={{ display: "flex", position: "absolute", left: 0, top: 22, width: Math.max(20, fill * track), height: 20, borderRadius: 10, background: `linear-gradient(90deg, ${C.won}, ${C.signal})` }} />
        {ms.map((m) => (
          <div key={m} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", left: at(c.a, m, c.t) * track - 40, top: 10, width: 80 }}>
            <div style={{ display: "flex", width: 4, height: 44, background: (c.s === "lost" ? c.b : c.p + c.k) >= m ? C.signal : "rgba(255,255,255,0.4)" }} />
            <div style={{ display: "flex", marginTop: 10, fontSize: 26, color: C.muted }}><Amt x={m} size={22} color={C.muted} short /></div>
          </div>
        ))}
        <div style={{ display: "flex", position: "absolute", left: fill * track - 22, top: 10, width: 44, height: 44, borderRadius: 22, background: C.signal }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", position: "absolute", right: -40, top: -6 }}>
          <div style={{ display: "flex", fontSize: 44, color: C.signal }}>⚑</div>
          <div style={{ display: "flex", fontSize: 26, color: C.signal }}><Amt x={c.t} size={22} color={C.signal} short /></div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 40 }}>
        {chips.map(([o, x], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 56, padding: "0 18px", borderRadius: 28, fontFamily: "Num", fontWeight: 800, fontSize: 30,
            background: x === "w" ? "rgba(143,184,240,0.18)" : x === "l" ? "rgba(255,138,122,0.2)" : "rgba(246,201,69,0.18)",
            color: x === "w" ? C.won : x === "l" ? C.lost : C.signal }}>{o.toFixed(2)}</div>
        ))}
      </div>
    </div>,
    { width: W, height: W, fonts: await loadFonts(), headers: { "Cache-Control": "private, max-age=60" } },
  );
}
