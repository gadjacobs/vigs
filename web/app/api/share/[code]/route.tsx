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
function Mark({ s, size = 34 }: { s: string; size?: number }) {
  if (s === "won") return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke={C.won} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke={C.lost} strokeWidth="3.2" strokeLinecap="round" /></svg>;
}

const time = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

// A share card for a booking code, drawn as a ticket around the code: square
// (posts, chats) or story (9:16). The legs show only as a strip of how each is
// going; the code itself carries them.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return new Response("Not a code", { status: 400 });
  const story = new URL(request.url).searchParams.get("f") === "story";
  const d = await shareData(code).catch(() => null);
  if (!d) return new Response("Code not found", { status: 404 });
  const W = 1080, H = story ? 1920 : 1080;
  const stateText = d.state === "won" ? "LANDED" : d.state === "lost" ? "MISSED" : "LIVE CODE";
  const stateColor = d.state === "won" ? C.won : d.state === "lost" ? C.lost : C.signal;
  const won = d.legs.filter((l) => l.status === "won").length;
  const last = d.legs.reduce((a, l) => Math.max(a, l.kickoff), 0);
  const codeSize = Math.min(story ? 220 : 190, Math.floor(1500 / Math.max(6, d.code.length)));
  const notch = (side: "left" | "right") => (
    <div style={{ position: "absolute", [side]: -34, top: -34, width: 68, height: 68, borderRadius: 34, background: C.ground, display: "flex" }} />
  );
  const stat = (big: React.ReactNode, small: string, color: string = C.ink) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1 }}>
      <div style={{ display: "flex", fontFamily: "Num", fontSize: 76, fontWeight: 800, color, lineHeight: 1 }}>{big}</div>
      <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 8, letterSpacing: 2 }}>{small}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "center", padding: story ? "96px 64px" : "48px 72px 40px",
        fontFamily: "Text", color: C.ink, backgroundColor: C.ground,
        backgroundImage: "radial-gradient(circle at 50% -10%, rgba(246,201,69,0.30), rgba(12,42,32,0) 60%)" }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: story ? 56 : 36 }}>
          <div style={{ display: "flex", fontSize: 76, fontFamily: "Num", fontWeight: 800, color: C.signal, lineHeight: 1 }}>Vig</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 700, color: C.ground, background: stateColor, padding: "10px 24px", borderRadius: 999, letterSpacing: 2 }}>{stateText}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", background: C.paper, borderRadius: 44, boxShadow: "0 40px 80px rgba(0,0,0,0.45)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: story ? "84px 48px 64px" : "56px 48px 44px" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: C.muted, letterSpacing: 6 }}>SPORTYBET BOOKING CODE</div>
            <div style={{ display: "flex", fontFamily: "Num", fontSize: codeSize, fontWeight: 800, letterSpacing: 14, lineHeight: 1, marginTop: 18, color: C.ink }}>{d.code}</div>
          </div>
          <div style={{ display: "flex", position: "relative", height: 0, borderTop: `4px dashed ${C.rule}`, margin: "0 40px" }}>
            {notch("left")}{notch("right")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: story ? "56px 56px 64px" : "40px 56px 44px" }}>
            <div style={{ display: "flex" }}>
              {d.odds ? stat(d.odds.toFixed(2), "ODDS", C.signal) : null}
              {stat(String(d.legs.length), "LEGS")}
              {d.state === "won" ? stat(<Mark s="won" size={76} />, "ALL WON", C.won)
                : d.state === "lost" ? stat(`${won}/${d.legs.length}`, "WON", C.lost)
                : d.chance !== null ? stat(`${Math.max(1, Math.round(d.chance * 100))}%`, "CHANCE") : null}
            </div>
            <div style={{ display: "flex", gap: d.legs.length > 24 ? 3 : 6, height: 16, marginTop: story ? 56 : 36 }}>
              {d.legs.map((l, i) => (
                <div key={i} style={{ display: "flex", flexGrow: 1, borderRadius: 8,
                  background: l.status === "won" ? C.won : l.status === "lost" ? C.lost : l.status === "playing" ? C.signal : C.rule }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 26, color: C.muted }}>
              <div style={{ display: "flex" }}>{won} of {d.legs.length} won</div>
              {last ? <div style={{ display: "flex" }}>last kick-off {time(last)} Lagos</div> : null}
            </div>
          </div>
        </div>
        {d.state === "won" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 40, fontSize: 40, fontWeight: 700, color: C.won }}>
            <Mark s="won" size={44} />Every leg landed
          </div>
        )}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 32, fontSize: 26, color: C.muted }}>
          Load it in SportyBet with the code · 18+
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts(), headers: { "Cache-Control": "private, max-age=60" } },
  );
}
