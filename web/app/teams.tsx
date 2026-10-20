import { teamColours } from "@/lib/teams";

/** A small two-colour crest in a team's club colours. */
export function Crest({ league, team }: { league: string; team: string }) {
  const [a, b] = teamColours(league, team);
  return <i className="crest" aria-hidden="true" style={{ "--c1": a, "--c2": b } as React.CSSProperties} />;
}

/** "LIV v HUL" with each side's crest. */
export function Teams({ league, home, away }: { league: string; home: string; away: string }) {
  return (
    <span className="teams">
      <span className="team"><Crest league={league} team={home} />{home}</span>
      <span className="vs">v</span>
      <span className="team"><Crest league={league} team={away} />{away}</span>
    </span>
  );
}
