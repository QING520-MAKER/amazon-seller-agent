import { describe, expect, it } from "vitest";
import createExample from "../examples/listing_create.json";
import auditExample from "../examples/listing_input.json";
import productExample from "../examples/product_brief.json";
import {
  createExampleRequest,
  parseIntent,
} from "../apps/web/src/intent.js";

describe("workbench command protocol", () => {
  it.each([
    ["研究 portable blender", "research"],
    ["research portable blender", "research"],
    ["选品 portable blender", "research"],
    ["关键词 portable blender", "research"],
    ["生成 listing", "listing-create"],
    ["create", "listing-create"],
    ["审计并优化 listing", "listing-audit"],
    ["audit listing", "listing-audit"],
    ["pipeline 研究 portable blender", "pipeline"],
    ["一键生成并审计 Listing", "pipeline"],
    ["全流程", "pipeline"],
  ])("routes %s to %s", (text, expected) => {
    expect(parseIntent(text)?.kind).toBe(expected);
  });

  it("returns null for free conversation instead of guessing a tool", () => {
    expect(parseIntent("你好，今天天气怎么样？")).toBeNull();
    expect(parseIntent("   ")).toBeNull();
  });

  it("extracts the user's research keyword and normalizes an explicit marketplace", () => {
    expect(parseIntent('研究 "travel coffee mug" Amazon UK')).toMatchObject({
      kind: "research",
      payload: { keyword: "travel coffee mug", marketplace: "uk", deep: false, compareWith: [] },
      exampleData: [],
    });
    expect(parseIntent("research portable blender de deep")).toMatchObject({
      payload: { keyword: "portable blender", marketplace: "de", deep: true },
    });
  });

  it("uses the seed example only when research is missing a keyword", () => {
    const request = parseIntent("研究");
    expect(request).toMatchObject({ payload: { keyword: "portable blender", marketplace: "us" } });
    expect(request?.exampleData.join(" ")).toContain("research_request.json");
  });

  it("uses the selected marketplace for new requests, with previous conversation context taking priority", () => {
    expect(parseIntent("研究 camping mug", undefined, "de")).toMatchObject({ payload: { marketplace: "de" } });
    const previous = createExampleRequest("listing-create", "uk");
    expect(parseIntent("研究 camping mug", previous, "de")).toMatchObject({ payload: { marketplace: "uk" } });
    expect(parseIntent('research {"keyword":"camping mug"}', undefined, "de")).toMatchObject({ payload: { marketplace: "de" } });
  });

  it("lets an explicit text or JSON marketplace override selected and previous marketplace defaults", () => {
    const previous = createExampleRequest("listing-create", "uk");
    expect(parseIntent("研究 camping mug 站点 ca", previous, "de")).toMatchObject({ payload: { marketplace: "ca" } });
    expect(parseIntent('research {"keyword":"camping mug","marketplace":"jp"}', previous, "de")).toMatchObject({ payload: { marketplace: "jp" } });
  });

  it("removes punctuation separating a keyword from command options", () => {
    expect(parseIntent("研究 portable blender，站点 us")).toMatchObject({ payload: { keyword: "portable blender", marketplace: "us" } });
    expect(parseIntent("research portable blender; marketplace uk")).toMatchObject({ payload: { keyword: "portable blender", marketplace: "uk" } });
  });

  it("rejects unsupported explicit marketplace codes instead of silently using US", () => {
    expect(() => parseIntent("research portable blender -m xx")).toThrow("Unknown marketplace xx");
    expect(() => parseIntent("研究 portable blender 站点 zz")).toThrow("Unknown marketplace zz");
    expect(() => createExampleRequest("listing-create", "xx")).toThrow("Unknown marketplace xx");
  });

  it("loads actual repository examples and reports which defaults were used", () => {
    const create = createExampleRequest("listing-create");
    const audit = createExampleRequest("listing-audit");
    const pipeline = createExampleRequest("pipeline");
    expect(create.payload).toEqual(createExample);
    expect(audit.payload).toEqual(auditExample);
    expect(pipeline.payload).toEqual({ keyword: "portable blender", marketplace: "us", product: productExample });
    expect(create.exampleData.join(" ")).toContain("listing_create.json");
    expect(audit.exampleData.join(" ")).toContain("listing_input.json");
    expect(pipeline.exampleData.join(" ")).toContain("product_brief.json");
  });

  it("accepts full request JSON without routing on text inside user product data", () => {
    const custom = {
      product: { name: "Research notebook", brand: "Mine", tone: "luxury" },
      keywords: ["research journal"],
      marketplace: "DE",
    };
    expect(parseIntent(`生成 ${JSON.stringify(custom)}`)).toMatchObject({
      kind: "listing-create",
      payload: { product: { name: "Research notebook", brand: "Mine", tone: "luxury" }, keywords: ["research journal"], marketplace: "de" },
      exampleData: [],
    });
  });

  it("fills only missing request fields and leaves explicitly empty keyword lists intact", () => {
    const request = parseIntent('create {"product":{"name":"My cup"},"keywords":[]}');
    expect(request).toMatchObject({ payload: { product: { name: "My cup" }, keywords: [] }, exampleData: [] });
    const partial = parseIntent('生成 {"product":{"name":"My cup"}}');
    expect(partial).toMatchObject({ payload: { product: { name: "My cup" }, keywords: createExample.keywords } });
    expect(partial?.exampleData).toHaveLength(1);
  });

  it("reports malformed JSON and invalid schema fields before making a request", () => {
    expect(() => parseIntent('create {"product":')).toThrow("无法读取请求 JSON");
    expect(() => parseIntent('create {"product":{"name":""}}')).toThrow("product.name");
    expect(() => parseIntent('research {"keyword":"cup","marketplace":"xx"}')).toThrow("Unknown marketplace xx");
    expect(() => parseIntent('research {"keyword":"cup","deep":"yes"}')).toThrow("deep");
  });

  it("changes marketplace while keeping the prior payload and example disclosures", () => {
    const previous = createExampleRequest("listing-create");
    const next = parseIntent("换站点 de", previous);
    expect(next).toMatchObject({ kind: "listing-create", payload: { ...createExample, marketplace: "de" }, exampleData: previous.exampleData });
    expect(previous.payload.marketplace).toBe("us");
    expect(() => parseIntent("换站点 xx", previous)).toThrow("Unknown marketplace xx");
  });

  it("expands the previous research deeply without changing its keyword", () => {
    const previous = parseIntent("研究 camping mug uk");
    const next = parseIntent("deep 扩词", previous!);
    expect(next).toMatchObject({ kind: "research", payload: { keyword: "camping mug", marketplace: "uk", deep: true } });
    expect(parseIntent("deep 扩词", createExampleRequest("listing-create"))).toBeNull();
  });

  it.each(["deep=false", "关闭deep", "关闭深度"])("disables deep research via %s in both new and follow-up requests", (option) => {
    const previous = parseIntent("研究 camping mug uk deep");
    expect(parseIntent(option, previous!)).toMatchObject({ payload: { keyword: "camping mug", marketplace: "uk", deep: false } });
    expect(parseIntent(`研究 camping mug uk ${option}`)).toMatchObject({ payload: { keyword: "camping mug", marketplace: "uk", deep: false } });
    expect(previous).toMatchObject({ payload: { deep: true } });
  });

  it("changes tone using a user's existing product rather than replacing it with the example", () => {
    const previous = parseIntent('create {"product":{"name":"Travel Mug","brand":"OwnBrand"},"keywords":["travel mug"]}');
    const next = parseIntent("换语气 luxury", previous!);
    expect(next).toMatchObject({
      kind: "listing-create",
      payload: { product: { name: "Travel Mug", brand: "OwnBrand", tone: "luxury" }, keywords: ["travel mug"] },
      exampleData: [],
    });
    expect(previous).toMatchObject({ payload: { product: { tone: "professional" } } });
  });

  it("adds a disclosed product brief when requesting a rewrite of the audit example", () => {
    const next = parseIntent("换语气，亲切一点", createExampleRequest("listing-audit"));
    expect(next).toMatchObject({
      kind: "listing-audit",
      payload: { listing: auditExample.listing, product: { ...productExample, tone: "friendly" } },
    });
    expect(next?.exampleData.join(" ")).toContain("product_brief.json");
  });

  it("does not mutate shared examples across conversations", () => {
    const first = createExampleRequest("listing-create");
    if (first.kind !== "listing-create") throw new Error("unexpected kind");
    first.payload.product.features.push("one conversation only");
    const second = createExampleRequest("listing-create");
    expect(second.payload).toEqual(createExample);
  });
});
