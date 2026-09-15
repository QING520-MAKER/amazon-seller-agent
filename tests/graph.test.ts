import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSellerGraph } from "../src/graph/index.js";
import {
  ListingCopySchema,
  ListingInputSchema,
  ListingResultSchema,
  ProductBriefSchema,
  ResearchReportSchema,
} from "../src/schemas.js";

const product = ProductBriefSchema.parse({
  name: "USB-C Blender",
  brand: "Acme",
  attributes: ["380ml", "USB-C rechargeable"],
  features: ["leak-proof lid"],
  audience: "travelers",
});
const originalListing = ListingInputSchema.parse({
  asin: "B0USERINPUT",
  title: "Original Blender",
  bullets: ["A small appliance."],
  description: "User-provided original description.",
  backendSearchTerms: ["compact mixer"],
  imageCount: 3,
  hasAPlus: false,
  price: 29.99,
  rating: 4.1,
  reviewCount: 80,
});
const keywords = ["portable blender", "travel blender"];

function completion(phrases: string[]): Response {
  return new Response(JSON.stringify({ suggestions: phrases.map((value) => ({ value })) }), {
    headers: { "Content-Type": "application/json" },
  });
}

function mockSuggestions(phrases: string[]) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => completion(phrases));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("AUTOCOMPLETE_DELAY_MS", "0");
  vi.stubEnv("AUTOCOMPLETE_TIMEOUT_MS", "1000");
  vi.stubEnv("OPENAI_API_KEY", "");
});

describe("compiled seller graph", () => {
  it("research returns a valid report and normalized keyword state, then ends", async () => {
    const fetchMock = mockSuggestions([
      " portable blender for travel ", "PORTABLE BLENDER FOR TRAVEL", "how to clean portable blender", "portable blender 380ml",
    ]);

    const result = await buildSellerGraph().invoke({
      intent: "research", keyword: "  portable   blender ", marketplace: "US",
    });
    const report = ResearchReportSchema.parse(JSON.parse(JSON.stringify(result.researchReport)));

    expect(report.keyword).toBe("portable blender");
    expect(report.marketplace).toBe("us");
    expect(report.keywords).toEqual([
      { phrase: "portable blender for travel", intent: "commercial", source: "autocomplete" },
      { phrase: "how to clean portable blender", intent: "informational", source: "autocomplete" },
      { phrase: "portable blender 380ml", intent: "niche", source: "autocomplete" },
    ]);
    expect(result.keywords).toEqual(report.keywords.map((item) => item.phrase));
    expect(result.listingResult).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(report.competition).toMatchObject({
      estimatedCompetitors: null, priceMin: null, priceMax: null, priceAvg: null, averageRating: null, topBrands: [],
    });
    expect(report.competition.notes).toMatch(/not collected/);
    expect(report.seasonality).toMatchObject({ direction: "unknown", peakMonths: [] });
    expect(report.opportunity).toMatchObject({ priceRoom: "unknown", demandTrend: "unknown" });
  });

  it("listing_create returns valid local JSON and computed coverage without HTTP even with an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-must-not-trigger-an-automatic-request");

    const result = await buildSellerGraph().invoke({ intent: "listing_create", product, keywords });
    const listingResult = ListingResultSchema.parse(JSON.parse(JSON.stringify(result.listingResult)));

    expect(listingResult.listing.title).toContain("Acme portable blender");
    expect(listingResult.listing.bullets).toHaveLength(5);
    expect(listingResult.audit).toBeNull();
    expect(listingResult.coverage.rows.map((row) => row.keyword)).toEqual(keywords);
    expect(listingResult.coverage.rows[0]?.status).toBe("covered");
    expect(listingResult.coverage.rows[1]?.status).toBe("partial");
    expect(listingResult.coverage.coveragePct).toBe(100);
    expect(result.researchReport).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("listing_audit without a product preserves supplied copy and audits it without HTTP", async () => {
    const result = await buildSellerGraph().invoke({
      intent: "listing_audit", listingInput: originalListing, keywords,
    });
    const listingResult = ListingResultSchema.parse(JSON.parse(JSON.stringify(result.listingResult)));

    expect(listingResult.listing).toEqual(ListingCopySchema.parse(originalListing));
    expect(listingResult.audit).toBeTruthy();
    expect(listingResult.audit?.dimensions).toHaveLength(8);
    expect(listingResult.audit?.coverage).toEqual(listingResult.coverage);
    expect(listingResult.coverage).toMatchObject({ coveragePct: 0, uncovered: keywords });
    expect(listingResult.audit?.dimensions.find((dimension) => dimension.name === "Images")?.score).toBeGreaterThan(0);
    expect(listingResult.audit?.dimensions.find((dimension) => dimension.name === "Pricing")?.score).toBe(5);
    expect(result.researchReport).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("listing_audit with a product separates original audit coverage from returned rewrite coverage", async () => {
    const result = await buildSellerGraph().invoke({
      intent: "listing_audit", listingInput: originalListing, keywords, product,
    });
    const listingResult = ListingResultSchema.parse(result.listingResult);

    expect(listingResult.listing.title).toContain("Acme portable blender");
    expect(listingResult.listing).not.toEqual(ListingCopySchema.parse(originalListing));
    expect(listingResult.audit?.coverage.coveragePct).toBe(0);
    expect(listingResult.audit?.coverage.uncovered).toEqual(keywords);
    expect(listingResult.audit?.dimensions.find((dimension) => dimension.name === "SEO")?.score).toBe(0);
    expect(listingResult.audit?.dimensions.every((dimension) => /Audit refers to the original input/.test(dimension.notes))).toBe(true);
    expect(listingResult.coverage.coveragePct).toBe(100);
    expect(listingResult.coverage.uncovered).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pipeline retains research and uses its keywords to create the listing before ending", async () => {
    const researchedPhrases = ["portable blender for office", "portable blender with lid"];
    const fetchMock = mockSuggestions(researchedPhrases);

    const result = await buildSellerGraph().invoke({
      intent: "pipeline", keyword: "portable blender", product, keywords: ["stale keyword from caller"],
    });
    const report = ResearchReportSchema.parse(result.researchReport);
    const listingResult = ListingResultSchema.parse(JSON.parse(JSON.stringify(result.listingResult)));

    expect(result.intent).toBe("pipeline");
    expect(report.keywords.map((item) => item.phrase)).toEqual(researchedPhrases);
    expect(result.keywords).toEqual(researchedPhrases);
    expect(listingResult.listing.title).toContain("Acme portable blender for office");
    expect(listingResult.coverage.rows.map((row) => row.keyword)).toEqual(researchedPhrases);
    expect(listingResult.coverage.rows.every((row) => row.status !== "missing")).toBe(true);
    expect(JSON.stringify(listingResult)).not.toContain("stale keyword from caller");
    expect(listingResult.audit).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("pools comparison seeds once each and deduplicates their returned phrases", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const prefix = new URL(String(input)).searchParams.get("prefix") ?? "";
      return completion([
        "Shared Blender Phrase",
        prefix.toLowerCase().includes("personal") ? "personal blender for shakes" : "portable blender for travel",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildSellerGraph().invoke({
      intent: "research", keyword: " Portable   Blender ",
      compareWith: ["portable blender", "Personal   Blender", " personal blender ", "  "],
    });
    const report = ResearchReportSchema.parse(result.researchReport);

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("prefix"))).toEqual([
      "Portable Blender", "best Portable Blender", "cheap Portable Blender", "top Portable Blender",
      "Personal Blender", "best Personal Blender", "cheap Personal Blender", "top Personal Blender",
    ]);
    expect(result.keywords).toEqual(["Shared Blender Phrase", "portable blender for travel", "personal blender for shakes"]);
    expect(report.competition.notes).toMatch(/Suggestions from comparison seeds are pooled/);
  });

  it("passes deep research through to alphabet expansion", async () => {
    const fetchMock = mockSuggestions([]);

    const result = await buildSellerGraph().invoke({ intent: "research", keyword: "portable blender", deep: true });

    expect(ResearchReportSchema.safeParse(result.researchReport).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it("keeps an empty autocomplete response empty without inventing keyword or marketplace data", async () => {
    mockSuggestions([]);

    const result = await buildSellerGraph().invoke({ intent: "research", keyword: "portable blender" });
    const report = ResearchReportSchema.parse(result.researchReport);

    expect(result.keywords).toEqual([]);
    expect(report.keywords).toEqual([]);
    expect(report.opportunity.total).toBe(1);
    expect(report.competition.estimatedCompetitors).toBeNull();
    expect(report.seasonality.direction).toBe("unknown");
  });

  it.each(["research", "listing_create", "listing_audit", "pipeline"] as const)("rejects a bad marketplace for %s before HTTP", async (intent) => {
    await expect(buildSellerGraph().invoke({
      intent, keyword: "portable blender", product, listingInput: originalListing, keywords, marketplace: "xx",
    })).rejects.toThrow(/Unknown marketplace/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects listing creation without a product", async () => {
    await expect(buildSellerGraph().invoke({ intent: "listing_create", keywords })).rejects.toThrow(/product/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects auditing without a supplied listing", async () => {
    await expect(buildSellerGraph().invoke({ intent: "listing_audit", keywords })).rejects.toThrow(/listing/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only research seeds without HTTP", async () => {
    await expect(buildSellerGraph().invoke({ intent: "research", keyword: "   " })).rejects.toThrow(/keyword must not be blank/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["research", "pipeline"] as const)("propagates a failed research request instead of returning a fabricated %s result", async (intent) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(["valid suggestion from first request"]))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(buildSellerGraph().invoke({ intent, keyword: "portable blender", product }))
      .rejects.toThrow(/Amazon autocomplete failed.*HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
