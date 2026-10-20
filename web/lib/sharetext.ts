// Share text for a booking code, formatted per app. No link back to Vig yet.
export type ShareLeg = { home: string; away: string; label: string; odds: number | null; kickoff: number; status: string; score: string | null };
export type ShareData = {
  code: string; legs: ShareLeg[]; odds: number | null; chance: number | null; state: "open" | "won" | "lost"; stake?: number;
};

const time = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

function head(d: ShareData) {
  const odds = d.odds ? `${d.odds.toFixed(2)} odds` : "odds as booked";
  return `${d.legs.length} legs · ${odds}`;
}
function outcome(d: ShareData) {
  if (d.state === "won") return "Landed: every leg won.";
  if (d.state === "lost") return `Missed: ${d.legs.filter((l) => l.status === "won").length} of ${d.legs.length} legs won.`;
  return "";
}
const link = (d: ShareData) => `https://www.sportybet.com/ng/?shareCode=${d.code}`;
const lines = (...xs: string[]) => xs.filter((x) => x !== "").join("\n");

// Every text carries the code, one summary line and the link that opens it in
// SportyBet. The legs stay off the text: the code already holds them, and the
// share image shows them for anyone who wants to look first.

/** WhatsApp message, with WhatsApp's *bold* and _italic_. */
export const whatsapp = (d: ShareData) => lines(`*SportyBet code: ${d.code}*`, head(d), outcome(d), link(d), "_18+_");

/** Short caption for a WhatsApp status or Instagram story. */
export const statusCaption = (d: ShareData) => `SportyBet code ${d.code} · ${head(d)}${d.state === "won" ? " · landed ✅" : ""}`;

/** X post, kept under 280 characters. */
export const xPost = (d: ShareData) => lines(`🎟️ SportyBet code: ${d.code}`, head(d), outcome(d), "18+ #vFootball #SportyBet").slice(0, 280);

/** Plain text for an X DM or anywhere without formatting. */
export const plain = (d: ShareData) => lines(`SportyBet code: ${d.code}`, head(d), outcome(d), link(d), "18+");

/** Instagram caption. */
export const instagram = (d: ShareData) => lines(`SportyBet code: ${d.code}`, head(d), outcome(d), "18+", "", "#vFootball #SportyBet #virtualfootball");
