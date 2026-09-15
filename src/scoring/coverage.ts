import type { CoverageReport, ListingCopy, ListingInput } from "../schemas.js";

/** Case-insensitive substring match. Coverage % counts phrases found in any visible field. */
export function coverageReport(
  listing: ListingCopy | ListingInput,
  keywords: string[],
): CoverageReport {
  const title = listing.title.toLowerCase();
  const bullets = listing.bullets.map((bullet) => bullet.toLowerCase());
  const description = listing.description.toLowerCase();
  const seen = new Set<string>();
  const rows: CoverageReport["rows"] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    const phrase = keyword.toLowerCase();
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    const inTitle = title.includes(phrase);
    const inBullets = bullets.some((bullet) => bullet.includes(phrase));
    const inDescription = description.includes(phrase);
    rows.push({
      keyword, inTitle, inBullets, inDescription,
      status: inTitle && inBullets && inDescription ? "covered"
        : inTitle || inBullets || inDescription ? "partial" : "missing",
    });
  }
  const uncovered = rows.filter((row) => row.status === "missing").map((row) => row.keyword);
  return {
    rows,
    coveragePct: rows.length ? Math.round((rows.length - uncovered.length) / rows.length * 10000) / 100 : 0,
    uncovered,
  };
}
