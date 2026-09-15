import { Hono, type Context } from "hono";
import { z } from "zod";
import { sellerGraph } from "../graph/index.js";
import type { AgentUpdate } from "../graph/state.js";
import { getMarketplace } from "../marketplace.js";
import {
  ListingCreateRequestSchema,
  ListingOptimizeRequestSchema,
  ListingResultSchema,
  ProductBriefSchema,
  ResearchReportSchema,
  ResearchRequestSchema,
} from "../schemas.js";

// Compose existing contracts; the graph and CLI remain the source of business logic.
export const PipelineRequestSchema = ResearchRequestSchema
  .pick({ keyword: true, marketplace: true })
  .extend({ product: ProductBriefSchema });

type InvokeGraph = (input: AgentUpdate) => Promise<{
  researchReport?: unknown;
  listingResult?: unknown;
}>;

function validationIssues(error: z.ZodError) {
  return error.issues.map(({ path, message }) => ({ path: path.join("."), message }));
}

export function createApp(options: { invoke?: InvokeGraph } = {}) {
  const app = new Hono();
  const invoke = options.invoke ?? ((input: AgentUpdate) => sellerGraph.invoke(input));

  async function run<T extends { marketplace: string }>(
    c: Context,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    toState: (request: T) => AgentUpdate,
    resultField: "researchReport" | "listingResult",
  ): Promise<Response> {
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return c.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "请使用 application/json 提交请求。" } }, 415);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: "INVALID_JSON", message: "请求正文不是有效的 JSON。" } }, 400);
    }

    const request = schema.safeParse(body);
    if (!request.success) {
      return c.json({ error: {
        code: "INVALID_REQUEST",
        message: "请求字段不符合要求。",
        issues: validationIssues(request.error),
      } }, 422);
    }

    try {
      // Normalize supported codes exactly as the CLI does through getMarketplace.
      request.data.marketplace = getMarketplace(request.data.marketplace).code;
    } catch (error) {
      return c.json({ error: {
        code: "INVALID_MARKETPLACE",
        message: error instanceof Error ? error.message : "不支持该站点。",
      } }, 422);
    }

    const input = toState(request.data);
    if (typeof input.keyword === "string" && !input.keyword.trim()) {
      return c.json({ error: { code: "INVALID_REQUEST", message: "研究关键词不能为空。" } }, 422);
    }

    let result: Awaited<ReturnType<InvokeGraph>>;
    try {
      result = await invoke(input);
    } catch (error) {
      return c.json({ error: {
        code: "GRAPH_FAILED",
        message: error instanceof Error ? error.message : "工作流未能完成，请重试。",
      } }, 502);
    }

    const output = resultField === "researchReport"
      ? ResearchReportSchema.safeParse(result.researchReport)
      : ListingResultSchema.safeParse(result.listingResult);
    if (!output.success) {
      return c.json({ error: {
        code: "INVALID_RESULT",
        message: "工作流返回的结果未通过校验。",
        issues: validationIssues(output.error),
      } }, 500);
    }
    return c.json(output.data);
  }

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.post("/api/research", (c) => run(c, ResearchRequestSchema, (request) => ({
    ...request,
    intent: "research",
  }), "researchReport"));
  app.post("/api/listing-create", (c) => run(c, ListingCreateRequestSchema, (request) => ({
    ...request,
    intent: "listing_create",
  }), "listingResult"));
  app.post("/api/listing-audit", (c) => run(c, ListingOptimizeRequestSchema, (request) => ({
    intent: "listing_audit",
    listingInput: request.listing,
    product: request.product,
    keywords: request.keywords,
    marketplace: request.marketplace,
  }), "listingResult"));
  app.post("/api/pipeline", (c) => run(c, PipelineRequestSchema, (request) => ({
    ...request,
    intent: "pipeline",
  }), "listingResult"));

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "接口不存在。" } }, 404));
  app.onError((_error, c) => c.json({ error: { code: "INTERNAL_ERROR", message: "服务暂时无法处理请求。" } }, 500));
  return app;
}

export const app = createApp();
