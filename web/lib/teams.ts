// Club colours for vFootball's short team names, per league (LEV is Leverkusen
// in Germany and Levante in Spain). Two colours each: the crest is split
// diagonally. Unknown teams get two colours worked out from their name.

const C: Record<string, [string, string]> = {
  // England
  "England|ARS": ["#EF0107", "#FFFFFF"], "England|AST": ["#670E36", "#95BFE5"], "England|BHA": ["#0057B8", "#FFFFFF"],
  "England|BOU": ["#DA291C", "#111111"], "England|BRE": ["#E30613", "#FFFFFF"], "England|CHE": ["#034694", "#FFFFFF"],
  "England|COV": ["#59B8E8", "#FFFFFF"], "England|CRY": ["#1B458F", "#C4122E"], "England|EVE": ["#003399", "#FFFFFF"],
  "England|FUL": ["#FFFFFF", "#111111"], "England|HUL": ["#F5A12D", "#111111"], "England|IPS": ["#0044A9", "#FFFFFF"],
  "England|LEE": ["#FFFFFF", "#1D428A"], "England|LIV": ["#C8102E", "#F6EB61"], "England|MCI": ["#6CABDD", "#FFFFFF"],
  "England|MUN": ["#DA291C", "#FBE122"], "England|NEW": ["#241F20", "#FFFFFF"], "England|NFO": ["#DD0000", "#FFFFFF"],
  "England|SUN": ["#EB172B", "#FFFFFF"], "England|TOT": ["#FFFFFF", "#132257"],
  // France
  "France|AMO": ["#E7192F", "#FFFFFF"], "France|ANG": ["#111111", "#FFFFFF"], "France|AUX": ["#FFFFFF", "#2A5FAA"],
  "France|B29": ["#E30613", "#FFFFFF"], "France|LEH": ["#6CB4E4", "#0C2340"], "France|LEN": ["#FFE600", "#E30613"],
  "France|LIL": ["#E01E13", "#20325F"], "France|LOR": ["#F58113", "#111111"], "France|LYO": ["#FFFFFF", "#14387F"],
  "France|MAN": ["#E30613", "#FFD100"], "France|NCE": ["#E30613", "#111111"], "France|OLM": ["#FFFFFF", "#2FAEE0"],
  "France|PFC": ["#002D62", "#FFFFFF"], "France|PSG": ["#004170", "#DA291C"], "France|REN": ["#E30613", "#111111"],
  "France|STR": ["#009FE3", "#FFFFFF"], "France|TOU": ["#6E2C91", "#FFFFFF"], "France|TRO": ["#0055A4", "#FFFFFF"],
  // Germany
  "Germany|BMG": ["#111111", "#00A650"], "Germany|BMU": ["#DC052D", "#FFFFFF"], "Germany|BVB": ["#FDE100", "#111111"],
  "Germany|FCA": ["#BA3733", "#46714D"], "Germany|HSV": ["#0A3F86", "#FFFFFF"], "Germany|KOE": ["#ED1C24", "#FFFFFF"],
  "Germany|LEV": ["#E32221", "#111111"], "Germany|MAI": ["#C3141E", "#FFFFFF"], "Germany|PAD": ["#003B7A", "#111111"],
  "Germany|RBL": ["#DD0741", "#FFFFFF"], "Germany|SCF": ["#E2001A", "#111111"], "Germany|SCH": ["#004D9D", "#FFFFFF"],
  "Germany|SGE": ["#E1000F", "#111111"], "Germany|SVE": ["#111111", "#FFFFFF"], "Germany|SVW": ["#1D9053", "#FFFFFF"],
  "Germany|TSG": ["#1C63B7", "#FFFFFF"], "Germany|UNI": ["#EB1923", "#FFFFFF"], "Germany|VFB": ["#FFFFFF", "#E32219"],
  // Italy
  "Italy|ACM": ["#FB090B", "#111111"], "Italy|ATA": ["#1E71B8", "#111111"], "Italy|BFC": ["#A21C26", "#1A2F48"],
  "Italy|CAG": ["#B5121B", "#002350"], "Italy|COM": ["#1D4F91", "#FFFFFF"], "Italy|FIO": ["#482E92", "#FFFFFF"],
  "Italy|FRO": ["#FFD200", "#0057A8"], "Italy|GEN": ["#A41E34", "#002F6C"], "Italy|INT": ["#010E80", "#111111"],
  "Italy|JUV": ["#111111", "#FFFFFF"], "Italy|LAZ": ["#87D8F7", "#FFFFFF"], "Italy|LEC": ["#FFED00", "#DA291C"],
  "Italy|MON": ["#E3001B", "#FFFFFF"], "Italy|NAP": ["#12A0D7", "#FFFFFF"], "Italy|PAR": ["#FFD100", "#0047AB"],
  "Italy|ROM": ["#8E1F2F", "#F0BC42"], "Italy|SAS": ["#00A752", "#111111"], "Italy|TOR": ["#8A1E03", "#FFFFFF"],
  "Italy|UDI": ["#FFFFFF", "#111111"], "Italy|VEN": ["#F37021", "#00843D"],
  // Spain
  "Spain|ALA": ["#0761AF", "#FFFFFF"], "Spain|ATM": ["#CB3524", "#FFFFFF"], "Spain|BIL": ["#EE2523", "#FFFFFF"],
  "Spain|CEL": ["#8AC3EE", "#FFFFFF"], "Spain|ELC": ["#FFFFFF", "#05642C"], "Spain|ESP": ["#007FC8", "#FFFFFF"],
  "Spain|FCB": ["#A50044", "#004D98"], "Spain|GET": ["#005999", "#FFFFFF"], "Spain|LEV": ["#B4053F", "#004D98"],
  "Spain|MCF": ["#00A7E1", "#FFFFFF"], "Spain|OSA": ["#D91A21", "#0A346F"], "Spain|RAC": ["#FFFFFF", "#00733E"],
  "Spain|RAY": ["#FFFFFF", "#E53027"], "Spain|RBB": ["#00954C", "#FFFFFF"], "Spain|RCD": ["#E20613", "#111111"],
  "Spain|RMA": ["#FFFFFF", "#FEBE10"], "Spain|RSO": ["#0067B1", "#FFFFFF"], "Spain|SEV": ["#FFFFFF", "#D71920"],
  "Spain|VCF": ["#FFFFFF", "#EE3524"], "Spain|VIL": ["#FFE667", "#005187"],
};

/** A team's two colours: its club colours when known, else two worked out from its name. */
export function teamColours(league: string, team: string): [string, string] {
  const known = C[`${league}|${team}`] ?? Object.entries(C).find(([k]) => k.endsWith(`|${team}`))?.[1];
  if (known) return known;
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return [`hsl(${h} 62% 42%)`, `hsl(${(h + 150) % 360} 70% 88%)`];
}
