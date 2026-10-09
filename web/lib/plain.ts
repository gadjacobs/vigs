// Plain-language view of a pick: a chance in whole percent, "about 1 in N",
// and a confidence rating from how wide the 90% range is. While the guard is
// in use that range spans the market price and the results model, so a wide
// range means they disagree, which is where the model has been least reliable.

export type Confidence = "High" | "Medium" | "Low";

const logit = (p: number) => {
  const x = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(x / (1 - x));
};

/** High: range within 5 points and tight on the odds scale; Low: wider than 10 points or loose. */
export function confidence(lo: number, hi: number): Confidence {
  const width = hi - lo;
  const spread = logit(hi) - logit(lo);
  if (width > 0.1 || spread > 0.6) return "Low";
  if (width <= 0.05 && spread <= 0.3) return "High";
  return "Medium";
}

export const CONFIDENCE_WHY: Record<Confidence, string> = {
  High: "the bookmaker's price and our results model agree closely",
  Medium: "the bookmaker's price and our results model differ a little",
  Low: "the bookmaker's price and our results model disagree, so treat the chance as rough",
};

const ORDER: Confidence[] = ["Low", "Medium", "High"];

/** A slip is only as clear as its least clear leg. */
export function slipConfidence(legs: { lo: number; hi: number }[]): Confidence {
  return legs.reduce<Confidence>((worst, l) => {
    const c = confidence(l.lo, l.hi);
    return ORDER.indexOf(c) < ORDER.indexOf(worst) ? c : worst;
  }, "High");
}

/** Whole percent, kept between 1 and 99 so rounding never claims certainty. */
export const chance = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;

/** "about 7 in 10" for likely outcomes, "about 1 in 7" for unlikely ones. */
export function oneIn(p: number): string {
  if (p >= 0.5) return `about ${Math.min(9, Math.round(p * 10))} in 10`;
  return `about 1 in ${Math.max(2, Math.round(1 / Math.max(p, 1e-4))).toLocaleString("en-NG")}`;
}
