import { multiBonus } from "@/lib/bonus";

/**
 * How much of the stake a slip like this keeps over many plays: its odds times
 * the bookmaker's own chance that every leg lands. Every leg pays the bookmaker's
 * cut, so it falls as legs are added; the record bears it out (Double up kept
 * about ₦954 per ₦1,000, Thousand about ₦480). SportyBet's multi-bet bonus is
 * shown apart: it isn't confirmed for vFootball, and the record doesn't count it.
 */
export function KeepMeter({ legs }: { legs: { odds: number; marketChance: number }[] }) {
  if (!legs.length) return null;
  const straight = legs.reduce((a, p) => a * p.odds * p.marketChance, 1);
  const withBonus = multiBonus(legs.map((p) => ({ odds: p.odds, p: p.marketChance }))).payback;
  const naira = (x: number) => `₦${Math.round(Math.min(x, 1.5) * 1000).toLocaleString("en-NG")}`;
  const tone = straight >= 0.93 ? "good" : straight >= 0.8 ? "mid" : "low";
  // The bar runs from ₦500 to ₦1,000 kept.
  const pos = Math.min(1, Math.max(0, (straight - 0.5) / 0.5));
  return (
    <div className={`keep keep-${tone}`}>
      <div className="keep-head">
        <span>Keeps about <b className="num">{naira(straight)}</b> of every ₦1,000</span>
        <span className="keep-tag">{tone === "good" ? "low cost" : tone === "mid" ? "costly" : "very costly"}</span>
      </div>
      <span className="keep-bar" aria-hidden="true"><i style={{ width: `${pos * 100}%` }} /></span>
      <small>Over many slips like this, by the bookmaker&apos;s own chances.
        {withBonus > straight + 0.005 ? ` About ${naira(withBonus)} if SportyBet pays its multi-bet bonus on it.` : ""}
        {tone !== "good" ? ` Each leg pays the bookmaker's cut: ${legs.length > 4 ? "fewer legs keep more." : "shorter prices keep more."}` : ""}</small>
    </div>
  );
}
