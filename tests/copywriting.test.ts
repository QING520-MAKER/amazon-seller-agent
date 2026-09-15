import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateListing } from "../src/copywriting.js";
import { ListingCopySchema, ProductBriefSchema, type ListingCopy, type ProductBrief, type Tone } from "../src/schemas.js";

const llm = vi.hoisted(() => {
  const invoke = vi.fn();
  const withStructuredOutput = vi.fn(() => ({ invoke }));
  const ChatOpenAI = vi.fn(function () { return { withStructuredOutput }; });
  return { invoke, withStructuredOutput, ChatOpenAI };
});

vi.mock("@langchain/openai", () => ({ ChatOpenAI: llm.ChatOpenAI }));

const keywords = ["portable blender", "travel blender", "personal blender", "compact blender", "blender bottle"];

const product = (changes: Partial<ProductBrief> = {}): ProductBrief => ProductBriefSchema.parse({
  name: "Travel Blender",
  brand: "BlendCo",
  attributes: ["380ml", "USB-C"],
  features: ["Detachable cup"],
  audience: "commuters",
  useCases: ["travel"],
  included: ["charging cable"],
  ...changes,
});

function expectWithinLimits(listing: ListingCopy) {
  expect(ListingCopySchema.safeParse(listing).success).toBe(true);
  expect(listing.title.length).toBeLessThanOrEqual(200);
  expect(listing.bullets).toHaveLength(5);
  for (const bullet of listing.bullets) {
    expect(bullet).toMatch(/^[A-Z][A-Z\s]* — \S/);
    expect(bullet.length).toBeLessThanOrEqual(500);
  }
  expect(listing.description.length).toBeLessThanOrEqual(2000);
  expect(Buffer.byteLength(listing.backendSearchTerms.join(" "), "utf8")).toBeLessThanOrEqual(249);
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_BASE_URL", "");
  vi.stubEnv("OPENAI_MODEL", "mock-model");
  llm.invoke.mockReset();
  llm.withStructuredOutput.mockClear();
  llm.ChatOpenAI.mockClear();
});

describe("template listing generation", () => {
  it.each(["", "test-api-key"])("uses a deterministic local template by default with key=%j", async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    const first = await generateListing(product(), keywords);
    const second = await generateListing(product(), keywords);
    expect(first).toEqual(second);
    expectWithinLimits(first);
    expect(llm.ChatOpenAI).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not invoke an LLM when opt-in is supplied without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "   ");
    expectWithinLimits(await generateListing(product(), keywords, { useLlm: true }));
    expect(llm.ChatOpenAI).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("places brand, primary keyword, attributes, and differentiator into the title in order", async () => {
    const listing = await generateListing(product(), keywords);
    expect(listing.title).toBe("BlendCo portable blender — 380ml — USB-C — Detachable cup");
    for (const [index, phrase] of keywords.entries()) {
      expect(listing.bullets[index]?.toLowerCase()).toContain(phrase);
    }
    expect(listing.description).toContain("portable blender");
    expectWithinLimits(listing);
  });

  it("moves unused complete keyword phrases to backend terms within the combined UTF-8 byte limit", async () => {
    const remaining = Array.from({ length: 40 }, (_, index) => `户外便携搅拌机配件${index}`);
    const listing = await generateListing(product(), [...keywords, ...remaining]);
    expect(listing.backendSearchTerms.length).toBeGreaterThan(1);
    expect(listing.backendSearchTerms[0]).toBe(remaining[0]);
    expect(listing.backendSearchTerms.length).toBeLessThan(remaining.length);
    expect(listing.backendSearchTerms.every((phrase) => remaining.includes(phrase))).toBe(true);
    expect(listing.backendSearchTerms.some((phrase) => keywords.includes(phrase))).toBe(false);
    expect(Buffer.byteLength(listing.backendSearchTerms.join(" "), "utf8")).toBeLessThanOrEqual(249);
    const nextMissing = remaining.find((phrase) => !listing.backendSearchTerms.includes(phrase))!;
    expect(Buffer.byteLength([...listing.backendSearchTerms, nextMissing].join(" "), "utf8")).toBeGreaterThan(249);
  });

  it("cleans and deduplicates empty and repeated keywords", async () => {
    const listing = await generateListing(product(), ["", "  PORTABLE   blender  ", "portable blender", "  ", "travel blender"]);
    expect(listing.title).toContain("PORTABLE blender");
    expect(listing.title).not.toContain("   ");
    expect(listing.bullets[0]).toContain("PORTABLE blender");
    expect(listing.bullets[1]).toContain("travel blender");
    expect(listing.bullets[2]).toContain("PORTABLE blender");
    expect(listing.backendSearchTerms).toEqual([]);
    expectWithinLimits(listing);
  });

  it("falls back to the product name when the keyword list has no usable phrases", async () => {
    const listing = await generateListing(product({ brand: "" }), ["", "  "]);
    expect(listing.title.startsWith("Travel Blender")).toBe(true);
    expect(listing.bullets.every((bullet) => bullet.includes("Travel Blender"))).toBe(true);
    expect(listing.backendSearchTerms).toEqual([]);
    expectWithinLimits(listing);
  });

  it("bounds multilingual copy and long attributes without splitting surrogate pairs", async () => {
    const listing = await generateListing(product({
      name: "便携搅拌杯🥤",
      brand: "随行",
      attributes: ["容量🥤".repeat(300), "多用途🍓".repeat(300)],
      features: ["可拆卸杯身🍊".repeat(300)],
      audience: "通勤者🧑".repeat(300),
      useCases: ["旅行🌎".repeat(300)],
      included: ["充电线🔌".repeat(300)],
    }), ["便携搅拌杯", "旅行搅拌杯", "果汁搅拌杯", "个人搅拌杯", "搅拌水瓶"]);
    expectWithinLimits(listing);
    const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const text of [listing.title, ...listing.bullets, listing.description, ...listing.backendSearchTerms]) {
      expect(text).not.toMatch(unpairedSurrogate);
    }
  });

  it("does not let an oversized secondary keyword overflow bullets or backend terms", async () => {
    const oversized = "secondary ".repeat(60);
    const listing = await generateListing(product(), [keywords[0]!, oversized, "travel blender"]);
    expectWithinLimits(listing);
    expect(listing.bullets[1]).toContain("travel blender");
    expect(listing.backendSearchTerms).not.toContain(oversized.trim());
  });

  it.each(["", "   "])("rejects a blank product name (%j)", async (name) => {
    await expect(generateListing({ ...product(), name }, keywords)).rejects.toThrow();
    expect(llm.ChatOpenAI).not.toHaveBeenCalled();
  });

  it.each([
    { brand: "B".repeat(201), primary: "blender" },
    { brand: "Brand", primary: "a".repeat(201) },
    { brand: "B".repeat(100), primary: "a".repeat(100) },
  ])("rejects an unrepresentable brand and primary keyword rather than silently deleting them", async ({ brand, primary }) => {
    await expect(generateListing(product({ brand }), [primary])).rejects.toThrow(/200-character title limit/);
  });

  it("supports all four tones without adding scarcity or unsupported market claims", async () => {
    const descriptions: string[] = [];
    for (const tone of ["professional", "friendly", "urgent", "luxury"] satisfies Tone[]) {
      const listing = await generateListing(product({ tone }), keywords);
      descriptions.push(listing.description);
      expectWithinLimits(listing);
      expect(JSON.stringify(listing)).not.toMatch(/limited stock|only \d+ left|selling fast|sold out|best seller|guaranteed|certified|five.star|5.star/i);
    }
    expect(new Set(descriptions).size).toBe(4);
  });
});

describe("optional LLM polishing", () => {
  it("invokes the model only with explicit opt-in and a key, retaining the generated title", async () => {
    const template = await generateListing(product(), keywords);
    const description = "portable blender with the supplied detachable cup, intended for commuters.";
    llm.invoke.mockResolvedValue({ bullets: template.bullets, description });
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid/v1");
    const result = await generateListing(product(), keywords, { useLlm: true });
    expect(llm.ChatOpenAI).toHaveBeenCalledOnce();
    expect(llm.ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "test-api-key", model: "mock-model", configuration: { baseURL: "https://example.invalid/v1" },
    }));
    expect(llm.invoke).toHaveBeenCalledOnce();
    expect(result.title).toBe(template.title);
    expect(result.description).toBe(description);
    expectWithinLimits(result);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the usable template if optional polishing throws", async () => {
    const template = await generateListing(product(), keywords);
    llm.invoke.mockRejectedValue(new Error("Mock model unavailable"));
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    expect(await generateListing(product(), keywords, { useLlm: true })).toEqual(template);
    expect(llm.invoke).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "too few bullets", "overlong bullet", "missing keyword", "bad header", "empty description", "overlong description", "missing primary", "invalid shape",
  ])("falls back when the model returns %s", async (failure) => {
    const template = await generateListing(product(), keywords);
    const candidate: { bullets: unknown; description: string } = { bullets: [...template.bullets], description: template.description };
    switch (failure) {
      case "too few bullets": candidate.bullets = template.bullets.slice(0, 4); break;
      case "overlong bullet": candidate.bullets = [`DETAILS — portable blender ${"a".repeat(500)}`, ...template.bullets.slice(1)]; break;
      case "missing keyword": candidate.bullets = ["DETAILS — Nothing relevant here.", ...template.bullets.slice(1)]; break;
      case "bad header": candidate.bullets = ["portable blender body without a header", ...template.bullets.slice(1)]; break;
      case "empty description": candidate.description = " "; break;
      case "overlong description": candidate.description = `portable blender ${"a".repeat(2000)}`; break;
      case "missing primary": candidate.description = "Unrelated description."; break;
      case "invalid shape": candidate.bullets = "not an array"; break;
    }
    llm.invoke.mockResolvedValue(candidate);
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    expect(await generateListing(product(), keywords, { useLlm: true })).toEqual(template);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recomputes backend terms after polished visible copy adds a previously unused phrase", async () => {
    const extendedKeywords = [...keywords, "camping blender"];
    const template = await generateListing(product(), extendedKeywords);
    expect(template.backendSearchTerms).toContain("camping blender");
    llm.invoke.mockResolvedValue({ bullets: template.bullets, description: "portable blender and camping blender product overview." });
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    const result = await generateListing(product(), extendedKeywords, { useLlm: true });
    expect(result.backendSearchTerms).not.toContain("camping blender");
    expectWithinLimits(result);
  });
});
