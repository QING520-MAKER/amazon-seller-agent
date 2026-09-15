import type { Keyword, OpportunityScore } from "../schemas.js";

/** A keyword exploration heuristic, not a market demand or competition estimate. */
export function scoreOpportunity(keywords: Keyword[], seed: string): OpportunityScore {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const unique = new Map<string, Keyword>();
  for (const keyword of keywords) {
    const phrase = normalize(keyword.phrase);
    if (phrase && !unique.has(phrase)) unique.set(phrase, keyword);
  }
  const items = [...unique.entries()];
  const seedText = normalize(seed);
  const seedWords = seedText.split(" ").filter(Boolean).length;
  // Extensions must contain the seed and at least three words (or one more than the seed).
  const longTailCount = items.filter(([phrase]) => seedText && phrase.includes(seedText)
    && phrase.split(" ").length >= Math.max(3, seedWords + 1)).length;
  const commercialRatio = items.length ? items.filter(([, item]) => item.intent === "commercial").length / items.length : 0;
  const nicheRatio = items.length ? items.filter(([, item]) => item.intent === "niche").length / items.length : 0;
  const longTailPoints = Math.min(5, longTailCount / 4);
  const intentPoints = 4 * (commercialRatio + 0.5 * nicheRatio);
  const total = Math.max(1, Math.min(10, Math.round(1 + longTailPoints + intentPoints)));
  return {
    total,
    // The frozen contract has no unknown value; do not imply this is measured competition.
    competitionDensity: "medium",
    priceRoom: "unknown",
    demandTrend: "unknown",
    nichePotential: longTailCount >= 12 ? "high" : longTailCount >= 4 ? "medium" : "low",
    reasoning: `${items.length} unique suggestions; ${longTailCount} long-tail phrases containing the seed. Commercial intent ${(commercialRatio * 100).toFixed(1)}%, niche intent ${(nicheRatio * 100).toFixed(1)}%. Score = round(1 + min(5, longTailCount / 4) + 4 × (commercialRatio + 0.5 × nicheRatio)). competitionDensity is an unmeasured neutral placeholder required by the contract. Autocomplete provides no search volume, BSR, competitor counts, prices, or demand trend.`,
    recommendation: items.length === 0
      ? "No suggestions returned. Try a more specific seed before further research."
      : total >= 7
        ? "Prioritize these phrases for further validation with independent demand and competition data."
        : "Refine the seed and validate customer intent before making a product decision.",
  };
}
