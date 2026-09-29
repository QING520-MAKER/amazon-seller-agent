import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ContentEvidenceSchema, ImagePlanSchema, ImageReviewSchema, ImageRunSchema, ImageVersionSchema,
  OriginalAssetSchema,
  type CatalogPagination, type ContentEvidence, type ImagePlan, type ImageReview, type ImageRun,
  type ImageVersion, type OriginalAsset, type Page,
} from "../schemas.js";
import { CatalogError } from "../catalog/errors.js";
import { CatalogRepository } from "../catalog/repository.js";

interface VersionRow {
  id: string; product_id: string; source_revision_id: string; version_number: number;
  original_asset_id: string; original_asset_version: number; original_json: string; plan_json: string;
  evidence_json: string; mode: "local" | "model"; provider: string; model: string | null;
  mime_type: "image/png" | "image/jpeg"; width: number; height: number; size_bytes: number; sha256: string;
  generation_run_id: string; storage_key: string; created_at: string;
}
interface RunRow {
  id: string; product_id: string; request_id: string; source_revision_id: string; mode: "local" | "model";
  input_hash: string; input_json: string; status: ImageRun["status"]; image_version_id: string | null;
  error_code: string | null; error_message: string | null; started_at: string; finished_at: string | null;
}
interface ReviewRow { id: string; product_id: string; image_version_id: string; decision: "approved" | "rejected"; notes: string; created_at: string }

const versionDto = (row: VersionRow): ImageVersion => ImageVersionSchema.parse({
  id: row.id, productId: row.product_id, sourceRevisionId: row.source_revision_id,
  versionNumber: row.version_number, original: OriginalAssetSchema.parse(JSON.parse(row.original_json)),
  plan: ImagePlanSchema.parse(JSON.parse(row.plan_json)),
  evidence: JSON.parse(row.evidence_json).map((value: unknown) => ContentEvidenceSchema.parse(value)),
  mode: row.mode, provider: row.provider, model: row.model, mimeType: row.mime_type,
  width: row.width, height: row.height, sizeBytes: row.size_bytes, sha256: row.sha256,
  generationRunId: row.generation_run_id, createdAt: row.created_at,
});
const runDto = (row: RunRow): ImageRun => ImageRunSchema.parse({
  id: row.id, productId: row.product_id, requestId: row.request_id, sourceRevisionId: row.source_revision_id,
  mode: row.mode, status: row.status, imageVersionId: row.image_version_id,
  errorCode: row.error_code, errorMessage: row.error_message, startedAt: row.started_at, finishedAt: row.finished_at,
});
const reviewDto = (row: ReviewRow): ImageReview => ImageReviewSchema.parse({
  id: row.id, productId: row.product_id, imageVersionId: row.image_version_id,
  decision: row.decision, notes: row.notes, createdAt: row.created_at,
});

/** Durable image candidates, runs, and append-only reviews. */
export class ImageRepository {
  readonly db: Database.Database;
  constructor(readonly catalog: CatalogRepository) { this.db = catalog.db; }

  private product(productId: string) { return this.catalog.product(productId); }

  private row(productId: string, imageId: string): VersionRow {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM image_versions WHERE product_id=? AND id=?").get(productId, imageId) as VersionRow | undefined;
    if (!row) throw new CatalogError(404, "IMAGE_NOT_FOUND", "图片候选不存在。");
    return row;
  }

  version(productId: string, imageId: string) { return versionDto(this.row(productId, imageId)); }

  file(productId: string, imageId: string) {
    const row = this.row(productId, imageId);
    return { image: versionDto(row), storageKey: row.storage_key };
  }

  allFiles() {
    return (this.db.prepare("SELECT * FROM image_versions").all() as VersionRow[]).map(row => ({ ...versionDto(row), storageKey: row.storage_key }));
  }

  list(productId: string, page: CatalogPagination): Page<ImageVersion> {
    this.product(productId);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM image_versions WHERE product_id=?").get(productId) as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM image_versions WHERE product_id=? ORDER BY version_number DESC, id DESC LIMIT ? OFFSET ?")
      .all(productId, page.limit, page.offset) as VersionRow[];
    return { items: rows.map(versionDto), total, limit: page.limit, offset: page.offset };
  }

  run(productId: string, runId: string): ImageRun {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM image_runs WHERE product_id=? AND id=?").get(productId, runId) as RunRow | undefined;
    if (!row) throw new CatalogError(404, "IMAGE_RUN_NOT_FOUND", "图片制作记录不存在。");
    return runDto(row);
  }

  runs(productId: string, page: CatalogPagination): Page<ImageRun> {
    this.product(productId);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM image_runs WHERE product_id=?").get(productId) as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM image_runs WHERE product_id=? ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(productId, page.limit, page.offset) as RunRow[];
    return { items: rows.map(runDto), total, limit: page.limit, offset: page.offset };
  }

  /** Returns an exact request replay, while rejecting a reused ID with new input. */
  findRequest(productId: string, requestId: string, inputHash: string): ImageRun | null {
    this.product(productId);
    const row = this.db.prepare("SELECT * FROM image_runs WHERE product_id=? AND request_id=?")
      .get(productId, requestId) as RunRow | undefined;
    if (!row) return null;
    if (row.input_hash !== inputHash) throw new CatalogError(409, "IMAGE_REQUEST_CONFLICT", "相同请求 ID 对应了不同的图片输入，必须使用新的请求 ID。");
    return runDto(row);
  }

  latestReview(productId: string, imageId: string): ImageReview | null {
    const row = this.db.prepare("SELECT * FROM image_reviews WHERE product_id=? AND image_version_id=? ORDER BY rowid DESC LIMIT 1")
      .get(productId, imageId) as ReviewRow | undefined;
    return row ? reviewDto(row) : null;
  }

  startRun(input: {
    productId: string; requestId: string; sourceRevisionId: string; originalAssetId: string;
    originalAssetVersion: number; mode: "local" | "model"; inputHash: string; inputJson: string;
  }): { run: ImageRun; reused: boolean } {
    return this.db.transaction(() => {
      this.product(input.productId);
      const existing = this.db.prepare("SELECT * FROM image_runs WHERE product_id=? AND request_id=?")
        .get(input.productId, input.requestId) as RunRow | undefined;
      if (existing) {
        if (existing.input_hash !== input.inputHash) throw new CatalogError(409, "IMAGE_REQUEST_CONFLICT", "相同请求 ID 对应了不同的图片输入，必须使用新的请求 ID。");
        return { run: runDto(existing), reused: true };
      }
      const product = this.product(input.productId);
      if (product.currentRevisionId !== input.sourceRevisionId) throw new CatalogError(409, "SOURCE_REVISION_CONFLICT", "商品资料已更新，请使用当前资料版本制作图片。");
      const asset = this.catalog.asset(input.productId, input.originalAssetId);
      if (asset.archivedAt !== null) throw new CatalogError(409, "ORIGINAL_ASSET_ARCHIVED", "所选原图已归档，请重新选择有效原图。");
      if (asset.version !== input.originalAssetVersion) throw new CatalogError(409, "ORIGINAL_ASSET_VERSION_CONFLICT", "所选原图已变化，请刷新后重新制作。");
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO image_runs(id, product_id, request_id, source_revision_id, mode, input_hash, input_json, status, image_version_id, error_code, error_message, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, ?, NULL)")
        .run(id, input.productId, input.requestId, input.sourceRevisionId, input.mode, input.inputHash, input.inputJson, now);
      return { run: this.run(input.productId, id), reused: false };
    }).immediate();
  }

  completeRun(input: {
    id: string; productId: string; runId: string; sourceRevisionId: string; original: OriginalAsset;
    plan: ImagePlan; evidence: ContentEvidence[]; mode: "local" | "model"; provider: string; model: string | null;
    mimeType: "image/png" | "image/jpeg"; width: number; height: number; sizeBytes: number; sha256: string; storageKey: string;
  }): ImageVersion {
    return this.db.transaction(() => {
      const run = this.db.prepare("SELECT * FROM image_runs WHERE product_id=? AND id=?").get(input.productId, input.runId) as RunRow | undefined;
      if (!run) throw new CatalogError(404, "IMAGE_RUN_NOT_FOUND", "图片制作记录不存在。");
      if (run.status !== "running") {
        if (run.image_version_id) return this.version(input.productId, run.image_version_id);
        throw new CatalogError(409, "IMAGE_RUN_FINISHED", "该图片制作请求已经结束，不能重复提交结果。");
      }
      const id = input.id;
      const versionNumber = (this.db.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM image_versions WHERE product_id=?").get(input.productId) as { n: number }).n;
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO image_versions(id, product_id, source_revision_id, version_number, original_asset_id, original_asset_version, original_json, plan_json, evidence_json, mode, provider, model, mime_type, width, height, size_bytes, sha256, generation_run_id, storage_key, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.productId, input.sourceRevisionId, versionNumber, input.original.id, input.original.version, JSON.stringify(input.original), JSON.stringify(input.plan), JSON.stringify(input.evidence), input.mode, input.provider, input.model, input.mimeType, input.width, input.height, input.sizeBytes, input.sha256, input.runId, input.storageKey, now);
      this.db.prepare("UPDATE image_runs SET status='succeeded', image_version_id=?, finished_at=? WHERE product_id=? AND id=? AND status='running'")
        .run(id, now, input.productId, input.runId);
      return this.version(input.productId, id);
    }).immediate();
  }

  failRun(productId: string, runId: string, code: string, message: string) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE image_runs SET status='failed', error_code=?, error_message=?, finished_at=? WHERE product_id=? AND id=? AND status='running'")
      .run(code, message, now, productId, runId);
    return this.run(productId, runId);
  }

  interruptRun(productId: string, runId: string, code: string, message: string) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE image_runs SET status='interrupted', error_code=?, error_message=?, finished_at=? WHERE product_id=? AND id=? AND status='running'")
      .run(code, message, now, productId, runId);
    return this.run(productId, runId);
  }

  recoverRuns() {
    const now = new Date().toISOString();
    return this.db.prepare("UPDATE image_runs SET status='interrupted', error_code='INTERRUPTED', error_message=?, finished_at=? WHERE status='running'")
      .run("图片制作服务在完成前中断，结果未知；请使用新的请求 ID 重试。", now).changes;
  }

  review(productId: string, imageId: string, decision: "approved" | "rejected", notes: string): ImageReview {
    return this.db.transaction(() => {
      this.version(productId, imageId);
      const id = randomUUID();
      this.db.prepare("INSERT INTO image_reviews(id, product_id, image_version_id, decision, notes, created_at) VALUES(?, ?, ?, ?, ?, ?)")
        .run(id, productId, imageId, decision, notes, new Date().toISOString());
      const row = this.db.prepare("SELECT * FROM image_reviews WHERE product_id=? AND id=?").get(productId, id) as ReviewRow;
      return reviewDto(row);
    }).immediate();
  }
}
