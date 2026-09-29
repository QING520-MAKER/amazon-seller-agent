import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ContentEvidenceSchema, KnowledgeFieldsSchema, KnowledgeRevisionSchema,
  SaveKnowledgeSchema,
  type CatalogPagination, type ContentEvidence, type KnowledgeFields, type KnowledgeQuery,
  type KnowledgeRevision, type Page, type SaveKnowledge,
} from "../schemas.js";
import { CatalogError } from "../catalog/errors.js";
import { CatalogRepository } from "../catalog/repository.js";
import { CreateKnowledgeRequestSchema } from "./contracts.js";

interface EntryRow {
  id: string;
  product_id: string;
  current_revision_id: string;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  entry_id: string;
  product_id: string;
  revision_number: number;
  kind: KnowledgeRevision["kind"];
  title: string;
  content: string;
  source: string;
  status: KnowledgeRevision["status"];
  created_at: string;
}

interface CreateRequestRow {
  product_id: string;
  request_id: string;
  input_hash: string;
  entry_id: string;
  revision_id: string;
  created_at: string;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

function createInputHash(fields: KnowledgeFields): string {
  const canonical = JSON.stringify({
    kind: fields.kind,
    title: fields.title,
    content: fields.content,
    source: fields.source,
    status: fields.status,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function revisionDto(row: RevisionRow): KnowledgeRevision {
  return KnowledgeRevisionSchema.parse({
    id: row.id,
    entryId: row.entry_id,
    productId: row.product_id,
    revisionNumber: row.revision_number,
    kind: row.kind,
    title: row.title,
    content: row.content,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
  });
}

/** Durable, product-scoped, append-only knowledge records. */
export class KnowledgeRepository {
  readonly db: Database.Database;

  constructor(readonly catalog: CatalogRepository) {
    this.db = catalog.db;
  }

  private entry(productId: string, entryId: string): EntryRow {
    this.catalog.product(productId);
    const row = this.db.prepare("SELECT * FROM knowledge_entries WHERE product_id=? AND id=?")
      .get(productId, entryId) as EntryRow | undefined;
    if (!row) throw new CatalogError(404, "KNOWLEDGE_ENTRY_NOT_FOUND", "该商品的知识条目不存在。");
    return row;
  }

  private row(productId: string, entryId: string, revisionId: string): RevisionRow {
    this.entry(productId, entryId);
    const row = this.db.prepare("SELECT * FROM knowledge_revisions WHERE product_id=? AND entry_id=? AND id=?")
      .get(productId, entryId, revisionId) as RevisionRow | undefined;
    if (!row) throw new CatalogError(404, "KNOWLEDGE_REVISION_NOT_FOUND", "该知识条目版本不存在。");
    return row;
  }

  private current(productId: string, entryId: string): RevisionRow {
    const entry = this.entry(productId, entryId);
    const row = this.db.prepare("SELECT * FROM knowledge_revisions WHERE product_id=? AND entry_id=? AND id=?")
      .get(productId, entryId, entry.current_revision_id) as RevisionRow | undefined;
    if (!row) throw new CatalogError(500, "INVALID_KNOWLEDGE_STATE", "知识条目当前版本不存在，请检查本地存储。");
    return row;
  }

  create(productId: string, fields: KnowledgeFields, requestId?: string): KnowledgeRevision {
    const request = CreateKnowledgeRequestSchema.parse({ ...fields, ...(requestId === undefined ? {} : { requestId }) });
    const { requestId: key, ...fieldInput } = request;
    const data = KnowledgeFieldsSchema.parse(fieldInput);
    this.catalog.product(productId);
    return this.db.transaction(() => {
      if (key) {
        const existing = this.db.prepare("SELECT * FROM knowledge_create_requests WHERE product_id=? AND request_id=?")
          .get(productId, key) as CreateRequestRow | undefined;
        if (existing) {
          if (existing.input_hash !== createInputHash(data)) {
            throw new CatalogError(409, "KNOWLEDGE_CREATE_REQUEST_CONFLICT", "相同请求 ID 对应了不同的知识输入，请使用新的请求 ID。");
          }
          return this.revision(productId, existing.entry_id, existing.revision_id);
        }
      }

      const entryId = randomUUID();
      const revisionId = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO knowledge_entries(id, product_id, current_revision_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?)")
        .run(entryId, productId, revisionId, now, now);
      this.db.prepare("INSERT INTO knowledge_revisions(id, entry_id, product_id, revision_number, kind, title, content, source, status, created_at) VALUES(?, ?, ?, 1, ?, ?, ?, ?, ?, ?)")
        .run(revisionId, entryId, productId, data.kind, data.title, data.content, data.source, data.status, now);
      if (key) {
        this.db.prepare("INSERT INTO knowledge_create_requests(product_id, request_id, input_hash, entry_id, revision_id, created_at) VALUES(?, ?, ?, ?, ?, ?)")
          .run(productId, key, createInputHash(data), entryId, revisionId, now);
      }
      return this.revision(productId, entryId, revisionId);
    }).immediate();
  }

  save(productId: string, entryId: string, input: SaveKnowledge): KnowledgeRevision {
    const data = SaveKnowledgeSchema.parse(input);
    return this.db.transaction(() => {
      const current = this.current(productId, entryId);
      if (current.id !== data.baseRevisionId) {
        throw new CatalogError(409, "KNOWLEDGE_REVISION_CONFLICT", "知识条目已在另一窗口修改，请刷新后再保存。", { currentRevisionId: current.id });
      }
      const unchanged = current.kind === data.kind && current.title === data.title && current.content === data.content
        && current.source === data.source && current.status === data.status;
      if (unchanged) return revisionDto(current);

      const revisionId = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO knowledge_revisions(id, entry_id, product_id, revision_number, kind, title, content, source, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(revisionId, entryId, productId, current.revision_number + 1, data.kind, data.title, data.content, data.source, data.status, now);
      const updated = this.db.prepare("UPDATE knowledge_entries SET current_revision_id=?, updated_at=? WHERE product_id=? AND id=? AND current_revision_id=?")
        .run(revisionId, now, productId, entryId, data.baseRevisionId);
      if (updated.changes !== 1) {
        throw new CatalogError(409, "KNOWLEDGE_REVISION_CONFLICT", "知识条目已更新，请刷新后再保存。", { currentRevisionId: this.current(productId, entryId).id });
      }
      return this.revision(productId, entryId, revisionId);
    }).immediate();
  }

  list(productId: string, query: KnowledgeQuery): Page<KnowledgeRevision> {
    // HTTP callers parse query strings through KnowledgeQuerySchema. Repository
    // callers already receive the typed numeric pagination contract used by the
    // catalog repositories, so parsing again would reject valid numbers.
    const data = query;
    this.catalog.product(productId);
    const clauses = ["e.product_id=?"];
    const params: unknown[] = [productId];
    if (data.status !== "all") {
      clauses.push("r.status=?");
      params.push(data.status);
    }
    if (data.q) {
      const search = `%${escapeLike(data.q)}%`;
      clauses.push("(r.title LIKE ? ESCAPE '\\' OR r.content LIKE ? ESCAPE '\\' OR r.source LIKE ? ESCAPE '\\')");
      params.push(search, search, search);
    }
    const where = clauses.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries e JOIN knowledge_revisions r ON r.product_id=e.product_id AND r.id=e.current_revision_id WHERE ${where}`)
      .get(...params) as { n: number }).n;
    const rows = this.db.prepare(`SELECT r.* FROM knowledge_entries e JOIN knowledge_revisions r ON r.product_id=e.product_id AND r.id=e.current_revision_id WHERE ${where} ORDER BY e.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .all(...params, data.limit, data.offset) as RevisionRow[];
    return { items: rows.map(revisionDto), total, limit: data.limit, offset: data.offset };
  }

  revision(productId: string, entryId: string, revisionId: string): KnowledgeRevision {
    return revisionDto(this.row(productId, entryId, revisionId));
  }

  history(productId: string, entryId: string, page: CatalogPagination): Page<KnowledgeRevision> {
    this.entry(productId, entryId);
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM knowledge_revisions WHERE product_id=? AND entry_id=?")
      .get(productId, entryId) as { n: number }).n;
    const rows = this.db.prepare("SELECT * FROM knowledge_revisions WHERE product_id=? AND entry_id=? ORDER BY revision_number DESC, id DESC LIMIT ? OFFSET ?")
      .all(productId, entryId, page.limit, page.offset) as RevisionRow[];
    return { items: rows.map(revisionDto), total, limit: page.limit, offset: page.offset };
  }

  resolveEvidence(productId: string, revisionIds: string[]): ContentEvidence[] {
    this.catalog.product(productId);
    if (revisionIds.length > 20) throw new CatalogError(422, "KNOWLEDGE_LIMIT", "一次最多选择 20 条已确认知识。");
    const selected: string[] = [];
    const seen = new Set<string>();
    for (const revisionId of revisionIds) {
      if (seen.has(revisionId)) continue;
      seen.add(revisionId);
      if (selected.length >= 20) break;
      selected.push(revisionId);
    }
    if (!selected.length) return [];
    const placeholders = selected.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT r.* FROM knowledge_revisions r JOIN knowledge_entries e ON e.product_id=r.product_id AND e.current_revision_id=r.id WHERE r.product_id=? AND r.status='approved' AND r.id IN (${placeholders})`)
      .all(productId, ...selected) as RevisionRow[];
    const byId = new Map(rows.map(row => [row.id, row]));
    return selected.map(id => {
      const row = byId.get(id);
      if (!row) throw new CatalogError(422, "KNOWLEDGE_NOT_APPROVED", "选中的知识不存在、属于其他商品、尚未确认或版本已变化。请刷新后重新选择。");
      return ContentEvidenceSchema.parse({
        entryId: row.entry_id, revisionId: row.id, title: row.title,
        content: row.content, source: row.source, kind: row.kind,
      });
    });
  }

  staleReasons(productId: string, evidence: ContentEvidence[]): string[] {
    this.catalog.product(productId);
    const reasons = new Set<string>();
    for (const item of evidence) {
      const entry = this.db.prepare("SELECT current_revision_id FROM knowledge_entries WHERE product_id=? AND id=?")
        .get(productId, item.entryId) as { current_revision_id: string } | undefined;
      if (!entry) {
        reasons.add("KNOWLEDGE_MISSING");
        continue;
      }
      const current = this.db.prepare("SELECT status FROM knowledge_revisions WHERE product_id=? AND entry_id=? AND id=?")
        .get(productId, item.entryId, entry.current_revision_id) as { status: KnowledgeRevision["status"] } | undefined;
      if (!current || entry.current_revision_id !== item.revisionId) reasons.add("KNOWLEDGE_UPDATED");
      if (current?.status === "archived") reasons.add("KNOWLEDGE_ARCHIVED");
    }
    return [...reasons];
  }
}
