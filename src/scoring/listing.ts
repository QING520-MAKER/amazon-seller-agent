import type { DimensionScore, ListingAudit, ListingInput } from "../schemas.js";
import { coverageReport } from "./coverage.js";

/**
 * 8-dimension audit totaling 100:
 * Title 15, Bullets 15, Images 15, A+ 10, Description 10,
 * Pricing 10, Reviews 15, SEO coverage 10.
 * Missing fields: score conservatively and explain in notes.
 */
export function auditListing(listing: ListingInput, keywords: string[]): ListingAudit {
  const coverage = coverageReport(listing, keywords);
  const dimensions: DimensionScore[] = [];
  const add = (name: string, score: number, maxScore: number, notes: string) => {
    dimensions.push({ name, score: Math.max(0, Math.min(maxScore, Math.round(score))), maxScore, notes });
  };
  const title = listing.title.trim();
  const primary = coverage.rows[0];
  add("Title", title ? 5 + (listing.title.length <= 200 ? 5 : 0) + (primary?.inTitle ? 5 : 0) : 0, 15,
    !title ? "Title missing; 0 points." : `5 for a nonempty title, 5 for length ≤200, 5 for the primary keyword. Length: ${listing.title.length}; primary keyword ${primary ? primary.inTitle ? "present" : "missing" : "not supplied"}.`);

  const bulletPoints = listing.bullets.slice(0, 5).reduce((sum, bullet) => {
    if (!bullet.trim()) return sum;
    return sum + 1 + (bullet.length <= 500 ? 1 : 0) + (/^[\p{Lu}\d][\p{Lu}\d\s&/(),'-]* — \S/u.test(bullet) ? 1 : 0);
  }, 0);
  add("Bullets", bulletPoints - (listing.bullets.length > 5 ? 1 : 0), 15,
    `First five bullets earn 1 each for content, length ≤500, and BENEFIT HEADER — body format. Supplied: ${listing.bullets.length}; expected 5.${listing.bullets.length > 5 ? " One point deducted for extra bullets." : ""}`);

  const images = listing.imageCount;
  const validImages = images != null && Number.isInteger(images) && images >= 0;
  add("Images", validImages ? Math.min(15, images / 7 * 15) : 0, 15,
    validImages ? `${images} images supplied; count-only heuristic reaches 15 at 7 images. Image quality and compliance were not inspected.` : "Image count missing or invalid; 0 points. No images were inspected.");

  add("A+", listing.hasAPlus === true ? 10 : 0, 10,
    listing.hasAPlus === true ? "A+ presence reported by the user; content quality not inspected."
      : listing.hasAPlus === false ? "User reports no A+ content; 0 points." : "A+ information missing; 0 points.");

  const description = listing.description.trim();
  add("Description", description ? 4 + (listing.description.length <= 2000 ? 3 : 0)
    + (description.length >= 200 && listing.description.length <= 2000 ? 3 : 0) : 0, 10,
    !description ? "Description missing; 0 points." : `4 for content, 3 for length ≤2000, 3 for at least 200 characters within that limit. Length: ${listing.description.length}; factual claims were not independently verified.`);

  const price = listing.price;
  const validPrice = price != null && Number.isFinite(price) && price > 0;
  add("Pricing", validPrice ? 5 : 0, 10,
    validPrice ? "Positive price supplied: 5/10. No comparable prices or cost data; price competitiveness and margin cannot be assessed."
      : "Price missing or invalid; 0 points. No market price data was collected.");

  const count = listing.reviewCount;
  const validCount = count != null && Number.isInteger(count) && count >= 0;
  const rating = listing.rating;
  const validRating = rating != null && Number.isFinite(rating) && rating >= 0 && rating <= 5;
  const countScore = validCount && count > 0 ? Math.min(5, 1 + Math.floor(Math.log10(count))) : 0;
  const ratingScore = validCount && count > 0 && validRating ? rating / 5 * 10 : 0;
  add("Reviews", countScore + ratingScore, 15,
    `${validCount ? `Review count: ${count}.` : "Review count missing or invalid; no count or rating points."} ${validRating ? `Rating supplied: ${rating}/5.` : "Rating missing or invalid; no rating points."} Count earns up to 5 (1 + floor(log10(count))); rating earns up to 10 only with a positive review count. User-supplied data only.`);

  add("SEO", coverage.coveragePct / 10, 10,
    coverage.rows.length ? `${coverage.coveragePct}% of ${coverage.rows.length} unique keywords appear in at least one visible field. Backend terms are excluded; partial coverage earns credit.`
      : "No target keywords supplied; coverage cannot be assessed, 0 points.");
  return { total: dimensions.reduce((sum, dimension) => sum + dimension.score, 0), dimensions, coverage };
}
