import type { CodeGroup, HabitRow } from "./record";
import { MARKET_LABELS } from "./markets";

// Plain notes from a person's own settled codes: what has happened, against what
// the prices said. Each note needs enough codes or legs to say anything, and
// says what landed rather than predicting anything.

export const LENGTH_ORDER = ["1 leg", "2-3 legs", "4-6 legs", "7-10 legs", "11-20 legs", "21+ legs"];
export const TIME_ORDER = ["Morning (06-12)", "Afternoon (12-18)", "Evening (18-24)", "Night (00-06)"];
const MIN_CODES = 8;
const MIN_LEGS = 30;

const naira = (x: number) => `${x < 0 ? "−" : ""}₦${Math.abs(Math.round(x)).toLocaleString("en-NG")}`;
const ofN = (r: HabitRow) => `${r.landed} of ${r.settled}`;
const slips = (k: string) => `${k.replace(/ legs?$/, "-leg")} slips`; // "2-3 legs" -> "2-3-leg slips"

export function habitNotes(g: CodeGroup, stake: number): string[] {
  const notes: string[] = [];
  const len = g.habits?.length ?? {};
  const rows = LENGTH_ORDER.filter((k) => (len[k]?.settled ?? 0) >= MIN_CODES).map((k) => [k, len[k]] as const);
  if (rows.length >= 2) {
    const best = [...rows].sort((a, b) => b[1].roi - a[1].roi)[0];
    const worst = [...rows].sort((a, b) => a[1].roi - b[1].roi)[0];
    if (best[0] !== worst[0] && best[1].roi - worst[1].roi > 0.3)
      notes.push(`Your ${slips(best[0])} landed ${ofN(best[1])} and paid back ${Math.round((best[1].roi + 1) * 100)}% of stakes; ` +
        `your ${slips(worst[0])} landed ${ofN(worst[1])} and paid back ${Math.round((worst[1].roi + 1) * 100)}%.`);
  }
  const long = ["11-20 legs", "21+ legs"].map((k) => len[k]).filter(Boolean) as HabitRow[];
  const longN = long.reduce((a, r) => a + r.settled, 0), longL = long.reduce((a, r) => a + r.landed, 0);
  if (longN >= MIN_CODES && longL === 0)
    notes.push(`None of your ${longN} slips with more than 10 legs has landed; at their prices about ${long.reduce((a, r) => a + r.expected_market, 0).toFixed(1)} were expected to.`);

  const mk = Object.entries(g.markets ?? {}).filter(([, r]) => r.settled >= MIN_LEGS)
    .map(([k, r]) => ({ k, r, d: r.hits - r.expected_market }));
  const up = mk.filter((x) => x.d >= Math.max(3, Math.sqrt(x.r.settled) * 0.5)).sort((a, b) => b.d - a.d)[0];
  const down = mk.filter((x) => x.d <= -Math.max(3, Math.sqrt(x.r.settled) * 0.5)).sort((a, b) => a.d - b.d)[0];
  if (up) notes.push(`Your ${(MARKET_LABELS[up.k] ?? up.k).toLowerCase()} legs landed ${up.r.hits} of ${up.r.settled}, ${up.d.toFixed(0)} more than their prices expected.`);
  if (down) notes.push(`Your ${(MARKET_LABELS[down.k] ?? down.k).toLowerCase()} legs landed ${down.r.hits} of ${down.r.settled}, ${Math.abs(down.d).toFixed(0)} fewer than their prices expected.`);

  if (g.settled >= MIN_CODES)
    notes.push(`At ${naira(stake)} a code, your ${g.settled} settled codes would have come to ${naira(g.roi * g.settled * stake)} (${g.landed} landed, ${g.expected_market.toFixed(1)} expected from the prices).`);
  return notes;
}
