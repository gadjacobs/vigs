import spots from "./tour-spots.json";

// The first-run tour: real screens of the app (captured by tools/tour_shots.py), each with
// one spot to point at. Spot boxes are percentages of the image, so they scale with it.
export type Box = { x: number; y: number; w: number; h: number };
export type TourSlide = { id: keyof typeof spots; tab: string; title: string; body: string };

export const TOUR: TourSlide[] = [
  {
    id: "tonight", tab: "Tonight",
    title: "Build a slip in two taps",
    body: "Choose markets and how many legs (or a total odds target), then Build slip. Every leg shows its chance of landing.",
  },
  {
    id: "picks", tab: "Our picks",
    title: "Or take one we cooked",
    body: "For each payout, from double your stake to 1,000 odds, Vig books the likeliest slip each round. Copy the code into SportyBet.",
  },
  {
    id: "codes", tab: "Codes",
    title: "Follow any code live",
    body: "Paste a booking code. Vig follows every leg as it plays and shows the chance the whole slip lands.",
  },
  {
    id: "bell", tab: "Codes",
    title: "Hear only what matters",
    body: "The bell on each code sets its alerts: just the result, every goal, or nothing.",
  },
  {
    id: "record", tab: "Record",
    title: "Nothing hidden",
    body: "Every pick is logged before kickoff and settled after. The record shows wins and losses alike.",
  },
];

export const SHOTS = spots as Record<TourSlide["id"], { src: string; w: number; h: number; spot: Box }>;
