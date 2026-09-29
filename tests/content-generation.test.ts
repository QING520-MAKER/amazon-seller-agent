import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateContent } from "../src/content/generation.js";
import { ProductBriefSchema } from "../src/schemas.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@langchain/openai", () => ({ ChatOpenAI: class {
  withStructuredOutput() { return { invoke }; }
} }));
const product = ProductBriefSchema.parse({ name: "Travel Mug", brand: "Acme", attributes: ["300 ml", "Stainless steel"], features: ["Removable lid"] });
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", ""); invoke.mockReset(); });

describe("product content generation", () => {
  it("creates the new title/highlights shape without changing the legacy template", async () => {
    const result = await generateContent(product, ["travel mug", "compact cup"], "template");
    expect(result.source).toBe("template");
    expect(result.copy.title).toContain("travel mug");
    expect(result.copy.title.length).toBeLessThanOrEqual(75);
    expect(result.copy.itemHighlights).toContain("300 ml");
    expect(result.copy.bullets).toHaveLength(5);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports an unconfigured model instead of disguising template fallback as AI success", async () => {
    await expect(generateContent(product, ["travel mug"], "model")).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("refuses to truncate a primary keyword that cannot fit", async () => {
    await expect(generateContent(product, ["x".repeat(76)], "template")).rejects.toMatchObject({ code: "TITLE_INPUT_TOO_LONG" });
  });
  it("records successful model output and passes selected evidence as data", async () => {
    const template = await generateContent(product, ["travel mug"], "template");
    vi.stubEnv("OPENAI_API_KEY", "test-not-a-secret");
    invoke.mockResolvedValue({ ...template.copy, itemHighlights: "300 ml stainless steel cup" });
    const evidence = [{ entryId: "a", revisionId: "b", title: "Manual", content: "300 ml", source: "manual page 2", kind: "product_fact" as const }];
    const result = await generateContent(product, ["travel mug"], "model", evidence);
    expect(result.source).toBe("model");
    expect(invoke.mock.calls[0]?.[0][1].content).toContain("manual page 2");
  });
  it("rejects byte overflow from the provider", async () => {
    const template = await generateContent(product, ["travel mug"], "template");
    vi.stubEnv("OPENAI_API_KEY", "test-not-a-secret");
    invoke.mockResolvedValue({ ...template.copy, backendSearchTerms: ["杯".repeat(100)] });
    await expect(generateContent(product, ["travel mug"], "model")).rejects.toMatchObject({ code: "INVALID_MODEL_RESULT" });
  });
  it("redacts upstream exception details", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-not-a-secret");
    invoke.mockRejectedValue(new Error("secret-value at E:\\private\\data"));
    await expect(generateContent(product, ["travel mug"], "model")).rejects.toMatchObject({ code: "MODEL_REQUEST_FAILED" });
    await expect(generateContent(product, ["travel mug"], "model")).rejects.not.toThrow("secret-value");
  });
});
