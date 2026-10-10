import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { shareData } from "@/lib/shareinfo";

export const dynamic = "force-dynamic";

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

/** Ticks and crosses drawn as shapes, so they never depend on a font. */
function Mark({ s }: { s: string }) {
  if (s === "won") return <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke={C.won} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (s === "lost") return <svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke={C.lost} strokeWidth="3.2" strokeLinecap="round" /></svg>;
  return <svg width="14" height="14" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill={C.muted} /></svg>;
}

const time = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

// A share card for a booking code: square (posts, chats) or story (9:16).
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return new Response("Not a code", { status: 400 });
  const story = new URL(request.url).searchParams.get("f") === "story";
  const d = await shareData(code).catch(() => null);
  if (!d) return new Response("Code not found", { status: 404 });
  const W = 1080, H = story ? 1920 : 1080;
  const max = story ? 14 : 5;
  const shown = d.legs.slice(0, max);
  const stateText = d.state === "won" ? "LANDED" : d.state === "lost" ? "MISSED" : "IN PLAY";
  const stateColor = d.state === "won" ? C.won : d.state === "lost" ? C.lost : C.signal;
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.ground, color: C.ink, padding: 72, fontFamily: "Text" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 72, fontFamily: "Num", fontWeight: 800, color: C.signal }}>Vig</div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: C.ground, background: stateColor, padding: "8px 20px", borderRadius: 999 }}>{stateText}</div>
        </div>
        <div style={{ display: "flex", flexShrink: 0, fontSize: 30, color: C.muted, marginTop: story ? "auto" : 28 }}>SportyBet booking code</div>
        <div style={{ display: "flex", flexShrink: 0, fontFamily: "Num", fontSize: story ? 180 : 132, fontWeight: 800, letterSpacing: 8, lineHeight: 1 }}>{d.code}</div>
        <div style={{ display: "flex", flexShrink: 0, gap: 40, marginTop: 8, fontSize: 40, alignItems: "baseline" }}>
          {d.odds && <div style={{ display: "flex" }}><span style={{ fontFamily: "Num", fontSize: 56, fontWeight: 800, color: C.signal, marginRight: 12 }}>{d.odds.toFixed(2)}</span>odds</div>}
          <div style={{ display: "flex" }}><span style={{ fontFamily: "Num", fontSize: 56, fontWeight: 800, marginRight: 12 }}>{d.legs.length}</span>legs</div>
          {d.chance !== null && <div style={{ display: "flex" }}><span style={{ fontFamily: "Num", fontSize: 56, fontWeight: 800, marginRight: 12 }}>{Math.max(1, Math.round(d.chance * 100))}%</span>chance</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: story ? 64 : 28, background: C.paper, borderRadius: 24, padding: "8px 32px" }}>
          {shown.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderTop: i ? `2px solid ${C.rule}` : "0", fontSize: 30 }}>
              <div style={{ display: "flex", width: 110, color: C.muted }}>{time(l.kickoff)}</div>
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                <div style={{ display: "flex", fontWeight: 700 }}>{l.home} v {l.away}{l.score ? ` · ${l.score}` : ""}</div>
                <div style={{ display: "flex", fontSize: 24, color: C.muted }}>{l.label}</div>
              </div>
              <div style={{ display: "flex", width: 110, justifyContent: "flex-end", fontFamily: "Num", fontSize: 38, fontWeight: 800 }}>{l.odds ? l.odds.toFixed(2) : ""}</div>
              <div style={{ display: "flex", width: 64, justifyContent: "flex-end", alignItems: "center" }}><Mark s={l.status} /></div>
            </div>
          ))}
          {d.legs.length > max && <div style={{ display: "flex", padding: "12px 0", fontSize: 26, color: C.muted, borderTop: `2px solid ${C.rule}` }}>+{d.legs.length - max} more legs</div>}
        </div>
        <div style={{ display: "flex", marginTop: "auto", paddingTop: 32, fontSize: 24, color: C.muted }}>
          18+ · Chances are Vig&apos;s estimates, not promises
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts(), headers: { "Cache-Control": "private, max-age=60" } },
  );
}
