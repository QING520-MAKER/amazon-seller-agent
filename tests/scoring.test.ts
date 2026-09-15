import { describe, expect, it } from "vitest";
import {
  CoverageReportSchema,
  ListingAuditSchema,
  ListingInputSchema,
  OpportunityScoreSchema,
  type Keyword,
  type KeywordIntent,
  type ListingInput,
} from "../src/schemas.js";
import { coverageReport } from "../src/scoring/coverage.js";
import { auditListing } from "../src/scoring/listing.js";
import { scoreOpportunity } from "../src/scoring/opportunity.js";

const keyword = (phrase: string, intent: KeywordIntent = "niche"): Keyword => ({
  phrase,
  intent,
  source: "autocomplete",
});

const emptyListing = (): ListingInput => ListingInputSchema.parse({});

describe("opportunity scoring", () => {
  it("returns the minimum score for an empty keyword set and declares unknown market data", () => {
    const report = scoreOpportunity([], "portable blender");
    expect(OpportunityScoreSchema.safeParse(report).success).toBe(true);
    expect(report.total).toBe(1);
    expect(report.priceRoom).toBe("unknown");
    expect(report.demandTrend).toBe("unknown");
    expect(report.reasoning).toMatch(/unmeasured|unknown/i);
    expect(report.reasoning).toMatch(/no search volume/i);
    expect(report.reasoning).toMatch(/BSR/);
    expect(report.reasoning).toMatch(/competitor counts/i);
    expect(report).not.toHaveProperty("searchVolume");
    expect(report).not.toHaveProperty("bsr");
    expect(report).not.toHaveProperty("estimatedCompetitors");
  });

  it("keeps scores integral and within 1–10 as keyword counts increase", () => {
    for (const count of [1, 3, 20, 1000]) {
      const report = scoreOpportunity(
        Array.from({ length: count }, (_, index) => keyword(`portable blender for use ${index}`, "commercial")),
        "portable blender",
      );
      expect(OpportunityScoreSchema.safeParse(report).success).toBe(true);
    }
  });

  it("does not let duplicate suggestions inflate the score", () => {
    const original = [keyword("portable blender"), keyword("portable blender for travel", "commercial")];
    const withDuplicates = [
      ...original,
      keyword("  PORTABLE   BLENDER  "),
      keyword("PORTABLE BLENDER FOR TRAVEL", "commercial"),
      keyword("   "),
    ];
    expect(scoreOpportunity(withDuplicates, " portable   BLENDER ")).toEqual(
      scoreOpportunity(original, "portable blender"),
    );
  });

  it("rewards additional seed-specific long tails without treating unrelated phrases as long tails", () => {
    const related = Array.from({ length: 16 }, (_, index) => keyword(`portable blender for use ${index}`, "informational"));
    const unrelated = Array.from({ length: 16 }, (_, index) => keyword(`coffee grinder for use ${index}`, "informational"));
    expect(scoreOpportunity(related, "portable blender").total).toBeGreaterThan(
      scoreOpportunity(related.slice(0, 4), "portable blender").total,
    );
    expect(scoreOpportunity(unrelated, "portable blender").total).toBe(1);
    expect(scoreOpportunity([keyword("portable blender", "informational")], "portable blender").total).toBe(1);
  });

  it("uses the intent ratio rather than raw counts or the suggestion source", () => {
    const withIntent = (intent: KeywordIntent) => Array.from(
      { length: 8 },
      (_, index) => keyword(`portable blender for use ${index}`, intent),
    );
    const informational = scoreOpportunity(withIntent("informational"), "portable blender");
    const niche = scoreOpportunity(withIntent("niche"), "portable blender");
    const commercial = scoreOpportunity(withIntent("commercial"), "portable blender");
    expect(informational.total).toBeLessThan(niche.total);
    expect(niche.total).toBeLessThan(commercial.total);
    expect(scoreOpportunity(withIntent("commercial").map((item) => ({ ...item, source: "user" })), "portable blender"))
      .toEqual(commercial);
  });
});

describe("keyword coverage", () => {
  it("computes case-insensitive covered, partial, and missing rows and a real percentage", () => {
    const report = coverageReport({
      ...emptyListing(),
      title: "PORTABLE BLENDER for Travel",
      bullets: ["SMOOTHIES — A Portable Blender for smoothies."],
      description: "Take your portable blender along.",
      backendSearchTerms: ["usb-c"],
    }, ["portable blender", "travel", "usb-c"]);
    expect(CoverageReportSchema.safeParse(report).success).toBe(true);
    expect(report.rows).toEqual([
      { keyword: "portable blender", inTitle: true, inBullets: true, inDescription: true, status: "covered" },
      { keyword: "travel", inTitle: true, inBullets: false, inDescription: false, status: "partial" },
      { keyword: "usb-c", inTitle: false, inBullets: false, inDescription: false, status: "missing" },
    ]);
    expect(report.coveragePct).toBeCloseTo(66.67, 2);
    expect(report.uncovered).toEqual(["usb-c"]);
  });

  it("recognizes partial matches independently in bullets and description", () => {
    const report = coverageReport({
      ...emptyListing(),
      bullets: ["For Camping"],
      description: "For the OFFICE.",
    }, ["camping", "office"]);
    expect(report.rows).toEqual([
      { keyword: "camping", inTitle: false, inBullets: true, inDescription: false, status: "partial" },
      { keyword: "office", inTitle: false, inBullets: false, inDescription: true, status: "partial" },
    ]);
    expect(report.coveragePct).toBe(100);
  });

  it("deduplicates trimmed keywords without changing the percentage denominator", () => {
    const report = coverageReport({ ...emptyListing(), title: "Portable Blender" }, [
      " portable blender ", "PORTABLE BLENDER", "missing", " missing ", "", "   ",
    ]);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]?.keyword).toBe("portable blender");
    expect(report.coveragePct).toBe(50);
    expect(report.uncovered).toEqual(["missing"]);
  });

  it("does not form a phrase across separate bullets", () => {
    const report = coverageReport({ ...emptyListing(), bullets: ["portable", "blender"] }, ["portable blender"]);
    expect(report.rows[0]?.status).toBe("missing");
    expect(report.coveragePct).toBe(0);
  });

  it("uses substring matching inside an individual visible field", () => {
    const report = coverageReport({ ...emptyListing(), description: "Portable blenders" }, ["portable blender"]);
    expect(report.rows[0]?.inDescription).toBe(true);
    expect(report.coveragePct).toBe(100);
  });

  it("returns an empty, finite report when no usable keywords are provided", () => {
    expect(coverageReport(emptyListing(), ["", "   "])).toEqual({ rows: [], coveragePct: 0, uncovered: [] });
  });
});

describe("listing audit", () => {
  const completeListing = (): ListingInput => ({
    title: "Brand Portable Blender for Travel",
    bullets: Array.from({ length: 5 }, () => "TRAVEL READY — Portable blender for everyday use."),
    description: "Portable blender for everyday travel. ".repeat(8),
    backendSearchTerms: [],
    imageCount: 7,
    hasAPlus: true,
    price: 39.99,
    rating: 5,
    reviewCount: 10000,
  });

  it("returns the eight required dimensions and calculates its total from bounded scores", () => {
    const audit = auditListing(completeListing(), ["portable blender", "travel", "absent"]);
    expect(ListingAuditSchema.safeParse(audit).success).toBe(true);
    expect(Object.fromEntries(audit.dimensions.map((dimension) => [dimension.name, dimension.maxScore]))).toEqual({
      Title: 15, Bullets: 15, Images: 15, "A+": 10, Description: 10, Pricing: 10, Reviews: 15, SEO: 10,
    });
    expect(audit.dimensions).toHaveLength(8);
    expect(audit.dimensions.reduce((sum, dimension) => sum + dimension.maxScore, 0)).toBe(100);
    expect(audit.total).toBe(audit.dimensions.reduce((sum, dimension) => sum + dimension.score, 0));
    for (const dimension of audit.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(dimension.maxScore);
      expect(dimension.notes.trim()).not.toBe("");
    }
    expect(audit.coverage).toEqual(coverageReport(completeListing(), ["portable blender", "travel", "absent"]));
  });

  it("scores absent fields conservatively and explains every dimension", () => {
    const audit = auditListing(emptyListing(), []);
    expect(audit.total).toBe(0);
    for (const dimension of audit.dimensions) {
      expect(dimension.score).toBe(0);
      expect(dimension.notes).toMatch(/missing|expected 5|no target keywords/i);
    }
  });

  it.each([
    { label: "null", imageCount: null, price: null, rating: null, reviewCount: null },
    { label: "negative", imageCount: -1, price: -1, rating: -1, reviewCount: -1 },
    { label: "NaN", imageCount: NaN, price: NaN, rating: NaN, reviewCount: NaN },
    { label: "infinite", imageCount: Infinity, price: Infinity, rating: Infinity, reviewCount: Infinity },
  ])("handles $label numeric inputs without inventing scores", ({ label: _label, ...input }) => {
    const audit = auditListing({ ...emptyListing(), ...input }, []);
    expect(Number.isFinite(audit.total)).toBe(true);
    for (const name of ["Images", "Pricing", "Reviews"]) {
      const dimension = audit.dimensions.find((item) => item.name === name);
      expect(dimension?.score).toBe(0);
      expect(dimension?.notes).toMatch(/missing|invalid/i);
    }
  });

  it("rejects fractional counts and out-of-range ratings as evidence for those points", () => {
    const audit = auditListing({ ...emptyListing(), imageCount: 1.5, reviewCount: 2.5, rating: 6 }, []);
    expect(audit.dimensions.find((item) => item.name === "Images")?.score).toBe(0);
    expect(audit.dimensions.find((item) => item.name === "Reviews")?.score).toBe(0);
    expect(audit.dimensions.find((item) => item.name === "Reviews")?.notes).toMatch(/rating missing or invalid/i);
  });

  it("does not award rating points without a positive review count", () => {
    for (const reviewCount of [undefined, null, 0]) {
      const audit = auditListing({ ...emptyListing(), rating: 5, reviewCount }, []);
      expect(audit.dimensions.find((item) => item.name === "Reviews")?.score).toBe(0);
    }
  });

  it("does not infer price competitiveness or image quality from supplied numbers", () => {
    const audit = auditListing(completeListing(), ["portable blender"]);
    const pricing = audit.dimensions.find((item) => item.name === "Pricing")!;
    expect(pricing.score).toBeGreaterThan(0);
    expect(pricing.score).toBeLessThan(pricing.maxScore);
    expect(pricing.notes).toMatch(/no comparable prices/i);
    expect(audit.dimensions.find((item) => item.name === "Images")?.notes).toMatch(/not inspected/i);
  });

  it("reduces copy scores for overlong title, bullets, and description", () => {
    const normal = auditListing(completeListing(), ["portable blender"]);
    const overlong = auditListing({
      ...completeListing(),
      title: `Portable blender ${"a".repeat(200)}`,
      bullets: Array.from({ length: 5 }, () => `TRAVEL READY — ${"a".repeat(500)}`),
      description: "a".repeat(2001),
    }, ["portable blender"]);
    for (const name of ["Title", "Bullets", "Description"]) {
      expect(overlong.dimensions.find((item) => item.name === name)!.score)
        .toBeLessThan(normal.dimensions.find((item) => item.name === name)!.score);
    }
  });

  it("changes SEO score when actual visible keyword coverage changes", () => {
    const listing = { ...emptyListing(), title: "portable blender", backendSearchTerms: ["travel"] };
    const partial = auditListing(listing, ["portable blender", "travel"]);
    const full = auditListing({ ...listing, description: "travel" }, ["portable blender", "travel"]);
    expect(partial.coverage.coveragePct).toBe(50);
    expect(full.coverage.coveragePct).toBe(100);
    expect(partial.dimensions.find((item) => item.name === "SEO")?.score).toBe(5);
    expect(full.dimensions.find((item) => item.name === "SEO")?.score).toBe(10);
  });
});
