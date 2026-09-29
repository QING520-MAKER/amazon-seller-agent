import {
  ContentCopySchema, ContentKeywordsSchema, GenerateContentSchema, type ContentCopy, type ContentEvidence,
  type ContentReview, type ContentRun, type ContentVersion, type GenerateContent, type Page, type CatalogPagination,
} from "../schemas.js";
import { coverageReport } from "../scoring/coverage.js";
import { CatalogError } from "../catalog/errors.js";
import { ContentRepository } from "./repository.js";
import { CONTENT_RULES_VERSION, ContentGenerationError, generateContent } from "./generation.js";
import { KnowledgeRepository } from "../knowledge/repository.js";

export type ContentGenerator = (
  product: Parameters<typeof generateContent>[0], keywords: string[], mode: "template" | "model", evidence: ContentEvidence[],
) => ReturnType<typeof generateContent>;

const safeMessages: Record<string, string> = {
  MODEL_NOT_CONFIGURED: "模型服务尚未配置，请选择模板生成或补充服务端配置。",
  MODEL_REQUEST_FAILED: "模型服务调用失败，生成记录已保留；请使用新的请求 ID 重试。",
  INVALID_MODEL_RESULT: "模型返回内容未通过校验，请使用新的请求 ID 重试。",
  TITLE_INPUT_TOO_LONG: "品牌和主关键词过长，请缩短后重试。",
  GENERATION_FAILED: "文案生成失败，请使用新的请求 ID 重试。",
};
function publicGenerationFailure(error: unknown) {
  if (error instanceof ContentGenerationError) {
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : "GENERATION_FAILED";
    return { code, message: safeMessages[code] ?? "文案生成未完成，请使用新的请求 ID 重试。" };
  }
  return { code: "GENERATION_FAILED", message: safeMessages.GENERATION_FAILED ?? "文案生成失败，请使用新的请求 ID 重试。" };
}

function listingForCoverage(copy: ContentCopy) {
  return { title: copy.title, bullets: copy.bullets, description: copy.description, backendSearchTerms: copy.backendSearchTerms };
}

export interface ContentServiceOptions { generateContent?: ContentGenerator; provider?: ContentGenerator; generate?: ContentGenerator }

/** Coordinates durable generation runs and keeps provider failures reviewable. */
export class ContentService {
  private activeGenerations = 0;
  private static readonly MAX_ACTIVE_GENERATIONS = 2;
  readonly provider: ContentGenerator;
  constructor(readonly repository: ContentRepository, provider?: ContentGenerator | ContentServiceOptions) {
    this.provider = typeof provider === "function" ? provider : provider?.generateContent ?? provider?.provider ?? provider?.generate ?? generateContent;
  }

  recoverRuns() { return this.repository.recoverRuns(); }

  async generate(productId: string, raw: GenerateContent) {
    const request = GenerateContentSchema.parse(raw);
    const canonical = JSON.stringify({
      sourceRevisionId: request.sourceRevisionId, baseContentVersionId: request.baseContentVersionId,
      marketplace: request.marketplace, language: "en_US", keywords: request.keywords,
      mode: request.mode, knowledgeRevisionIds: request.knowledgeRevisionIds,
    });
    const inputHash = ContentRepository.hashInput(canonical);
    // Replay must keep working even when the originally selected knowledge is now outdated.
    const existing = this.repository.findRequest(productId, request.requestId, inputHash);
    if (existing) return { run: existing, content: existing.contentVersionId ? this.repository.version(productId, existing.contentVersionId) : null, reused: true };
    const evidence = new KnowledgeRepository(this.repository.catalog).resolveEvidence(productId, request.knowledgeRevisionIds);
    const started = this.repository.startRun({
      productId, requestId: request.requestId, sourceRevisionId: request.sourceRevisionId,
      baseContentVersionId: request.baseContentVersionId, mode: request.mode,
      inputHash, inputJson: JSON.stringify({ ...JSON.parse(canonical), evidence }),
    });
    if (started.reused) {
      const content = started.run.contentVersionId ? this.repository.version(productId, started.run.contentVersionId) : null;
      return { run: started.run, content, reused: true };
    }

    // A local service must not build an unbounded in-memory provider queue.
    // Persist the rejected run so a caller can inspect the public reason, then
    // ask it to retry with a new request ID after capacity is available.
    if (this.activeGenerations >= ContentService.MAX_ACTIVE_GENERATIONS) {
      this.repository.failRun(productId, started.run.id, "CONTENT_GENERATION_BUSY", "已有两项文案生成正在运行，请稍后使用新的请求 ID 重试。");
      throw new CatalogError(503, "CONTENT_GENERATION_BUSY", "已有两项文案生成正在运行，请稍后使用新的请求 ID 重试。");
    }
    this.activeGenerations++;

    let generated: Awaited<ReturnType<ContentGenerator>>;
    try {
      const revision = this.repository.catalog.revision(productId, request.sourceRevisionId);
      generated = await this.provider(revision.brief, request.keywords, request.mode, evidence);
      const copy = ContentCopySchema.parse(generated.copy);
      const coverage = coverageReport(listingForCoverage(copy), request.keywords);
      const content = this.repository.completeRun({
        productId, runId: started.run.id, baseHeadId: started.baseHeadId, sourceRevisionId: request.sourceRevisionId,
        keywords: ContentKeywordsSchema.parse(request.keywords), copy, coverage, evidence,
        rulesVersion: CONTENT_RULES_VERSION, source: generated.source, model: generated.model,
      });
      return { run: this.repository.run(productId, started.run.id), content, reused: false };
    } catch (error) {
      if (error instanceof CatalogError && error.code === "CONTENT_HEAD_CONFLICT") {
        const run = this.repository.failRun(productId, started.run.id, "CONTENT_HEAD_CONFLICT", "文案版本已更新，请使用新的请求 ID 重试。");
        return { run, content: null, reused: false };
      }
      const failure = publicGenerationFailure(error);
      const run = this.repository.failRun(productId, started.run.id, failure.code, failure.message);
      return { run, content: null, reused: false };
    } finally {
      this.activeGenerations--;
    }
  }

  list(productId: string, page: CatalogPagination) { return this.repository.list(productId, page); }
  runs(productId: string, page: CatalogPagination) { return this.repository.runs(productId, page); }
  detail(productId: string, versionId: string) { return this.repository.detail(productId, versionId); }

  save(productId: string, input: { baseContentVersionId: string; copy: ContentCopy }) {
    const copy = ContentCopySchema.parse(input.copy);
    const base = this.repository.version(productId, input.baseContentVersionId);
    const coverage = coverageReport(listingForCoverage(copy), base.keywords);
    return this.repository.save({ productId, baseContentVersionId: input.baseContentVersionId, copy, coverage, rulesVersion: base.rulesVersion });
  }

  review(productId: string, versionId: string, decision: "approved" | "rejected", notes: string): ContentReview {
    return this.repository.review(productId, versionId, decision, notes);
  }

  export(productId: string, versionId: string, draft: boolean) { return this.repository.exportDetail(productId, versionId, draft); }
}

export type ContentServiceResult = Awaited<ReturnType<ContentService["generate"]>>;
export type ContentServiceRun = ContentRun;
export type ContentServiceVersion = ContentVersion;
