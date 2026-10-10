// Share text for a booking code, formatted per app. No link back to Vig yet.
export type ShareLeg = { home: string; away: string; label: string; odds: number | null; kickoff: number; status: string; score: string | null };
export type ShareData = {
  code: string; legs: ShareLeg[]; odds: number | null; chance: number | null; state: "open" | "won" | "lost"; stake?: number;
};

const time = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);
const mark = (s: string) => (s === "won" ? " ✅" : s === "lost" ? " ❌" : "");
const naira = (x: number) => `₦${Math.round(x).toLocaleString("en-NG")}`;
const pctText = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;

function head(d: ShareData) {
  const odds = d.odds ? `${d.odds.toFixed(2)} odds` : "odds as booked";
  return `${d.legs.length} legs · ${odds}`;
}
function outcome(d: ShareData) {
  if (d.state === "won") return "Landed: every leg won.";
  if (d.state === "lost") return `Missed: ${d.legs.filter((l) => l.status === "won").length} of ${d.legs.length} legs won.`;
  return "";
}
function chanceLine(d: ShareData) {
  if (d.chance === null) return "";
  const n = Math.max(2, Math.round(1 / Math.max(d.chance, 1e-4)));
  return `Vig's estimate: ${pctText(d.chance)} chance all land (about 1 in ${n}).`;
}
function stakeLine(d: ShareData) {
  return d.stake && d.odds ? `${naira(d.stake)} returns ${naira(d.stake * d.odds)} if all land.` : "";
}
function legLines(d: ShareData, max = 12) {
  const lines = d.legs.slice(0, max).map((l, i) =>
    `${i + 1}. ${time(l.kickoff)} ${l.home} v ${l.away}: ${l.label}${l.odds ? ` @ ${l.odds.toFixed(2)}` : ""}${mark(l.status)}`);
  if (d.legs.length > max) lines.push(`+${d.legs.length - max} more`);
  return lines;
}
const lines = (...xs: (string | string[])[]) => xs.flat().filter((x) => x !== "").join("\n");

/** WhatsApp message, with WhatsApp's *bold* and _italic_. */
export const whatsapp = (d: ShareData) => lines(`*SportyBet code: ${d.code}*`, head(d), "", legLines(d), "",
  outcome(d), chanceLine(d), stakeLine(d), "_18+. Estimates, not promises._");

/** Short caption for a WhatsApp status or Instagram story (the image carries the detail). */
export const statusCaption = (d: ShareData) => `SportyBet code ${d.code} · ${head(d)}${d.state === "won" ? " · landed ✅" : ""}`;

/** X post, kept under 280 characters. */
export function xPost(d: ShareData) {
  const parts = [`🎟️ SportyBet code: ${d.code}`, head(d) + (d.chance !== null ? ` · ${pctText(d.chance)} chance on Vig's estimate` : ""),
    outcome(d), "18+ · estimates, not promises", "#vFootball #SportyBet"].filter(Boolean);
  let text = parts.join("\n");
  if (text.length > 280) text = parts.filter((p) => !p.startsWith("#")).join("\n");
  return text.slice(0, 280);
}

/** Plain text for an X DM or anywhere without formatting. */
export const plain = (d: ShareData) => lines(`SportyBet code: ${d.code}`, head(d), "", legLines(d), "",
  outcome(d), chanceLine(d), stakeLine(d), "18+. Estimates, not promises.");

/** Instagram caption. */
export const instagram = (d: ShareData) => lines(`SportyBet code: ${d.code}`, head(d), outcome(d), chanceLine(d),
  "18+ · estimates, not promises", "", "#vFootball #SportyBet #virtualfootball");
