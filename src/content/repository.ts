import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ContentCopySchema, ContentEvidenceSchema, ContentReviewSchema, ContentVersionSchema, CoverageReportSchema,
  type CatalogPagination, type ContentCopy, type ContentEvidence, type ContentReview, type ContentRun,
  type ContentVersion, type Page,
} from "../schemas.js";
import { CatalogRepository } from "../catalog/repository.js";
import { CatalogError } from "../catalog/errors.js";
import { KnowledgeRepository } from "../knowledge/repository.js";

interface VersionRow {
  id: string; product_id: string; source_revision_id: string; version_number: number; parent_version_id: string | null;
  marketplace: "us"; language: "en_US"; keywords_json: string; copy_json: string; coverage_json: string;
  evidence_json: string; rules_version: string; source: "template" | "model" | "manual"; model: string | null;
  generation_run_id: string | null; created_at: string;
}
interface RunRow {
  id: string; product_id: string; request_id: string; source_revision_id: string; mode: "template" | "model";
  input_hash: string; input_json: string; status: ContentRun["status"]; content_version_id: string | null;
  error_code: string | null; error_message: string | null; started_at: string; finished_at: string | null;
}
interface ReviewRow { id: string; product_id: string; content_version_id: string; decision: "approved" | "rejected"; notes: string; created_at: string }

const versionDto = (row: VersionRow): ContentVersion => ContentVersionSchema.parse({
  id: row.id, productId: row.product_id, sourceRevisionId: row.source_revision_id,
  versionNumber: row.version_number, parentVersionId: row.parent_version_id,
  marketplace: row.marketplace, language: row.language,
  keywords: JSON.parse(row.keywords_json), copy: ContentCopySchema.parse(JSON.parse(row.copy_json)),
  coverage: CoverageReportSchema.parse(JSON.parse(row.coverage_json)),
  evidence: JSON.parse(row.evidence_json).map((value: unknown) => ContentEvidenceSchema.parse(value)),
  rulesVersion: row.rules_version, source: row.source, model: row.model,
  generationRunId: row.generation_run_id, createdAt: row.created_at,
});
const runDto = (row: RunRow): ContentRun => ({
  id: row.id, productId: row.product_id, requestId: row.request_id, sourceRevisionId: row.source_revision_id,
  mode: row.mode, status: row.status, contentVersionId: row.content_version_id,
  errorCode: row.error_code, errorMessage: row.error_message, startedAt: row.started_at, finishedAt: row.finished_at,
});
const reviewDto = (row: ReviewRow): ContentReview => ContentReviewSchema.parse({
  id: row.id, productId: row.product_id, contentVersionId: row.content_version_id,
  decision: row.decision, notes: row.notes, createdAt: row.created_at,
});

function publicConflict(message = "文案版本已更新，请刷新后再保存。") {
  return new CatalogError(409, "CONTENT_HEAD_CONFLICT", message);
}

/** Durable records for product-bound listing content. Content versions are append-only. */
export class ContentRepository {
  constructor(readonly db: Database.Database, readonly catalog = new CatalogRepository(db)) {}

  private product(productId: string) { return this.catalog.product(productId); }

  private row(productId: string, versionId: string): VersionRow {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM content_versions WHERE product_id=? AND id=?").get(productId, versionId) as VersionRow | undefined;
    if (!row) throw new CatalogError(404, "CONTENT_NOT_FOUND", "文案版本不存在。");
    return row;
  }

  version(productId: string, versionId: string) { return versionDto(this.row(productId, versionId)); }

  private headId(productId: string): string | null {
    const row = this.db.prepare("SELECT head_version_id FROM content_heads WHERE product_id=? AND marketplace='us' AND language='en_US'")
      .get(productId) as { head_version_id: string | null } | undefined;
    return row?.head_version_id ?? null;
  }

  head(productId: string) {
    const id = this.headId(productId);
    return id ? this.version(productId, id) : undefined;
  }

  list(productId: string, page: CatalogPagination): Page<ContentVersion> & { headVersionId: string | null } {
    this.product(productId);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM content_versions WHERE product_id=? AND marketplace='us' AND language='en_US'")
      .get(productId) as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM content_versions WHERE product_id=? AND marketplace='us' AND language='en_US' ORDER BY version_number DESC, id DESC LIMIT ? OFFSET ?")
      .all(productId, page.limit, page.offset) as VersionRow[];
    return { ...page, total, items: rows.map(versionDto), headVersionId: this.headId(productId) };
  }

  run(productId: string, runId: string): ContentRun {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM content_runs WHERE product_id=? AND id=?").get(productId, runId) as RunRow | undefined;
    if (!row) throw new CatalogError(404, "CONTENT_RUN_NOT_FOUND", "文案生成记录不存在。");
    return runDto(row);
  }

  private runByRequest(productId: string, requestId: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM content_runs WHERE product_id=? AND request_id=?").get(productId, requestId) as RunRow | undefined;
  }

  findRequest(productId: string, requestId: string, inputHash: string): ContentRun | undefined {
    this.product(productId);
    const row = this.runByRequest(productId, requestId);
    if (!row) return undefined;
    if (row.input_hash !== inputHash) throw new CatalogError(409, "CONTENT_REQUEST_CONFLICT", "相同请求 ID 对应了不同输入，请使用新的请求 ID。");
    return runDto(row);
  }

  runs(productId: string, page: CatalogPagination): Page<ContentRun> {
    this.product(productId);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM content_runs WHERE product_id=?").get(productId) as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM content_runs WHERE product_id=? ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(productId, page.limit, page.offset) as RunRow[];
    return { ...page, total, items: rows.map(runDto) };
  }

  /** Mark calls interrupted by a process restart before the service accepts work. */
  recoverRuns() {
    const now = new Date().toISOString();
    return this.db.prepare("UPDATE content_runs SET status='interrupted', error_code='INTERRUPTED', error_message=?, finished_at=? WHERE status='running'")
      .run("生成服务在完成前中断，结果未知；请使用新的请求 ID 重试。", now).changes;
  }

  startRun(input: {
    productId: string; requestId: string; sourceRevisionId: string; baseContentVersionId: string | null;
    mode: "template" | "model"; inputHash: string; inputJson: string;
  }): { run: ContentRun; reused: boolean; baseHeadId: string | null } {
    return this.db.transaction(() => {
      this.product(input.productId);
      const existing = this.runByRequest(input.productId, input.requestId);
      if (existing) {
        if (existing.input_hash !== input.inputHash) throw new CatalogError(409, "CONTENT_REQUEST_CONFLICT", "相同请求 ID 对应了不同的输入，必须使用新的请求 ID。");
        return { run: runDto(existing), reused: true, baseHeadId: this.headId(input.productId) };
      }
      const product = this.catalog.product(input.productId);
      if (product.currentRevisionId !== input.sourceRevisionId) {
        throw new CatalogError(409, "SOURCE_REVISION_CONFLICT", "商品资料已更新，请使用当前资料版本生成。");
      }
      this.catalog.revision(input.productId, input.sourceRevisionId);
      const headId = this.headId(input.productId);
      if (headId !== input.baseContentVersionId) throw publicConflict();
      if (!this.db.prepare("SELECT 1 FROM content_heads WHERE product_id=? AND marketplace='us' AND language='en_US'").get(input.productId)) {
        this.db.prepare("INSERT INTO content_heads(product_id, marketplace, language, head_version_id) VALUES(?, 'us', 'en_US', NULL)").run(input.productId);
      }
      const now = new Date().toISOString(), id = randomUUID();
      this.db.prepare("INSERT INTO content_runs(id, product_id, request_id, source_revision_id, mode, input_hash, input_json, status, content_version_id, error_code, error_message, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, ?, NULL)")
        .run(id, input.productId, input.requestId, input.sourceRevisionId, input.mode, input.inputHash, input.inputJson, now);
      return { run: this.run(input.productId, id), reused: false, baseHeadId: headId };
    }).immediate();
  }

  failRun(productId: string, runId: string, code: string, message: string) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE content_runs SET status='failed', error_code=?, error_message=?, finished_at=? WHERE product_id=? AND id=? AND status='running'")
      .run(code, message, now, productId, runId);
    return this.run(productId, runId);
  }

  private ensureHead(productId: string, expected: string | null) {
    const actual = this.headId(productId);
    if (actual !== expected) throw publicConflict();
    if (!this.db.prepare("SELECT 1 FROM content_heads WHERE product_id=? AND marketplace='us' AND language='en_US'").get(productId)) {
      this.db.prepare("INSERT INTO content_heads(product_id, marketplace, language, head_version_id) VALUES(?, 'us', 'en_US', NULL)").run(productId);
    }
  }

  private insertVersion(input: {
    productId: string; sourceRevisionId: string; parentVersionId: string | null; keywords: string[]; copy: ContentCopy;
    coverage: unknown; evidence: ContentEvidence[]; rulesVersion: string; source: "template" | "model" | "manual";
    model: string | null; generationRunId: string | null;
  }): ContentVersion {
    const product = this.catalog.product(input.productId);
    this.catalog.revision(input.productId, input.sourceRevisionId);
    if (input.parentVersionId) {
      const parent = this.row(input.productId, input.parentVersionId);
      if (parent.product_id !== product.id) throw new CatalogError(404, "CONTENT_NOT_FOUND", "文案版本不存在。");
    }
    const next = (this.db.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM content_versions WHERE product_id=? AND marketplace='us' AND language='en_US'")
      .get(input.productId) as { n: number }).n;
    const id = randomUUID(), now = new Date().toISOString();
    const coverage = CoverageReportSchema.parse(input.coverage);
    this.db.prepare("INSERT INTO content_versions(id, product_id, source_revision_id, version_number, parent_version_id, marketplace, language, keywords_json, copy_json, coverage_json, evidence_json, rules_version, source, model, generation_run_id, created_at) VALUES(?, ?, ?, ?, ?, 'us', 'en_US', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.productId, input.sourceRevisionId, next, input.parentVersionId, JSON.stringify(input.keywords), JSON.stringify(input.copy), JSON.stringify(coverage), JSON.stringify(input.evidence), input.rulesVersion, input.source, input.model, input.generationRunId, now);
    return this.version(input.productId, id);
  }

  completeRun(input: {
    productId: string; runId: string; baseHeadId: string | null; sourceRevisionId: string; keywords: string[];
    copy: ContentCopy; coverage: unknown; evidence: ContentEvidence[]; rulesVersion: string; source: "template" | "model";
    model: string | null;
  }): ContentVersion {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM content_runs WHERE product_id=? AND id=?").get(input.productId, input.runId) as RunRow | undefined;
      if (!row) throw new CatalogError(404, "CONTENT_RUN_NOT_FOUND", "文案生成记录不存在。");
      if (row.status !== "running") {
        if (row.content_version_id) return this.version(input.productId, row.content_version_id);
        throw new CatalogError(409, "CONTENT_RUN_FINISHED", "该生成请求已经结束，不能重复提交结果。");
      }
      this.ensureHead(input.productId, input.baseHeadId);
      const version = this.insertVersion({ ...input, parentVersionId: input.baseHeadId, generationRunId: input.runId });
      this.db.prepare("UPDATE content_heads SET head_version_id=? WHERE product_id=? AND marketplace='us' AND language='en_US'").run(version.id, input.productId);
      this.db.prepare("UPDATE content_runs SET status='succeeded', content_version_id=?, finished_at=? WHERE product_id=? AND id=? AND status='running'")
        .run(version.id, new Date().toISOString(), input.productId, input.runId);
      return version;
    }).immediate();
  }

  save(input: { productId: string; baseContentVersionId: string; copy: ContentCopy; coverage: unknown; rulesVersion: string }) {
    return this.db.transaction(() => {
      const base = this.row(input.productId, input.baseContentVersionId);
      this.ensureHead(input.productId, input.baseContentVersionId);
      const previous = ContentCopySchema.parse(JSON.parse((this.db.prepare("SELECT copy_json FROM content_versions WHERE id=?").get(base.id) as { copy_json: string }).copy_json));
      if (JSON.stringify(previous) === JSON.stringify(input.copy)) return versionDto(base);
      const version = this.insertVersion({
        productId: input.productId, sourceRevisionId: base.source_revision_id, parentVersionId: base.id,
        keywords: JSON.parse(base.keywords_json), copy: input.copy, coverage: input.coverage,
        evidence: JSON.parse(base.evidence_json), rulesVersion: input.rulesVersion, source: "manual", model: null, generationRunId: null,
      });
      this.db.prepare("UPDATE content_heads SET head_version_id=? WHERE product_id=? AND marketplace='us' AND language='en_US'").run(version.id, input.productId);
      return version;
    }).immediate();
  }

  review(productId: string, versionId: string, decision: "approved" | "rejected", notes: string) {
    return this.db.transaction(() => {
      const version = this.version(productId, versionId);
      const detail = this.detail(productId, version.id);
      if (decision === "approved" && detail.stale) throw new CatalogError(409, "CONTENT_STALE", "依据的商品资料或知识已更新，请重新生成后再批准。");
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO content_reviews(id, product_id, content_version_id, decision, notes, created_at) VALUES(?, ?, ?, ?, ?, ?)")
        .run(id, productId, versionId, decision, notes, now);
      return this.reviewById(productId, id);
    }).immediate();
  }

  reviewById(productId: string, reviewId: string) {
    const row = this.db.prepare("SELECT * FROM content_reviews WHERE product_id=? AND id=?").get(productId, reviewId) as ReviewRow | undefined;
    if (!row) throw new CatalogError(404, "CONTENT_REVIEW_NOT_FOUND", "审核记录不存在。");
    return reviewDto(row);
  }

  latestReview(productId: string, versionId: string): ContentReview | null {
    const row = this.db.prepare("SELECT * FROM content_reviews WHERE product_id=? AND content_version_id=? ORDER BY rowid DESC LIMIT 1")
      .get(productId, versionId) as ReviewRow | undefined;
    return row ? reviewDto(row) : null;
  }

  detail(productId: string, versionId: string) {
    const content = this.version(productId, versionId);
    const product = this.catalog.product(productId);
    const staleReasons: string[] = [];
    if (content.sourceRevisionId !== product.currentRevisionId) staleReasons.push("SOURCE_REVISION_CHANGED");
    staleReasons.push(...new KnowledgeRepository(this.catalog).staleReasons(productId, content.evidence));
    return { content, review: this.latestReview(productId, versionId), stale: staleReasons.length > 0, staleReasons };
  }

  exportDetail(productId: string, versionId: string, draft: boolean) {
    const detail = this.detail(productId, versionId);
    if (!draft) {
      if (detail.stale) throw new CatalogError(409, "CONTENT_STALE", "依据已过期，请重新生成并审核后导出。");
      if (!detail.review || detail.review.decision !== "approved") throw new CatalogError(409, "CONTENT_NOT_APPROVED", "只有明确批准的文案版本才能正式导出。");
    }
    return {
      schemaVersion: 1 as const, status: draft ? "draft" as const : "approved" as const,
      exportedAt: new Date().toISOString(), sku: this.catalog.product(productId).sku, detail,
    };
  }

  static hashInput(value: unknown) {
    return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
  }
}
