import type { Profile } from "./profile";

// How much detail the app shows: "simple" (chance, odds, what it returns) or
// "detailed" (Rich: break-even, the bookmaker's chance, range, edge, grade).
// New users start on Simple; the choice syncs with the account.
export type View = "simple" | "detailed";

export function viewOf(profile: Profile | null | undefined, cookie: string | undefined): View {
  const v = profile?.view ?? cookie;
  return v === "detailed" ? "detailed" : "simple";
}
