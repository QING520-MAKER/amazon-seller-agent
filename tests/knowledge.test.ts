import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { openCatalog, type CatalogService } from "../src/catalog/service.js";
import { CreateProductSchema } from "../src/schemas.js";
import { KnowledgeRepository } from "../src/knowledge/repository.js";
import { createKnowledgeRoutes } from "../src/knowledge/routes.js";

let catalog: CatalogService;
let knowledge: KnowledgeRepository;

const fields = (overrides: Record<string, unknown> = {}) => ({
  kind: "product_fact" as const,
  title: "Capacity",
  content: "500 ml",
  source: "Product manual page 2",
  status: "draft" as const,
  ...overrides,
});

async function setup() {
  const dataDir = await mkdtemp("E:\\CodexTemp\\asa-knowledge-");
  catalog = (await openCatalog({ dataDir })).catalog;
  knowledge = new KnowledgeRepository(catalog.repository);
}

function product(sku = "SKU-A") {
  return catalog.repository.create(CreateProductSchema.parse({ sku, brief: { name: "Travel Blender" } })).product;
}

beforeEach(async () => { await setup(); });
afterEach(() => catalog?.close());

describe("knowledge repository", () => {
  it("creates a draft and keeps the source and kind", () => {
    const item = knowledge.create(product().id, fields());
    expect(item).toMatchObject({
      entryId: expect.any(String), revisionNumber: 1, kind: "product_fact", status: "draft",
      title: "Capacity", content: "500 ml", source: "Product manual page 2",
    });
  });

  it("replays a keyed create, conflicts on changed input, and persists the original revision", async () => {
    const p = product();
    const requestId = randomUUID();
    const first = knowledge.create(p.id, fields(), requestId);
    const replay = knowledge.create(p.id, fields(), requestId);
    expect(replay).toEqual(first);
    expect(knowledge.list(p.id, { limit: 20, offset: 0, q: "", status: "all" }).total).toBe(1);
    expect(() => knowledge.create(p.id, fields({ content: "changed" }), requestId))
      .toThrowError(expect.objectContaining({ status: 409, code: "KNOWLEDGE_CREATE_REQUEST_CONFLICT" }));
    expect(() => knowledge.db.prepare("UPDATE knowledge_create_requests SET input_hash='bad' WHERE product_id=? AND request_id=?").run(p.id, requestId))
      .toThrow("immutable");
    expect(() => knowledge.db.prepare("DELETE FROM knowledge_create_requests WHERE product_id=? AND request_id=?").run(p.id, requestId))
      .toThrow("cannot be deleted");

    const dataDir = catalog.repository.db.name;
    catalog.close();
    catalog = (await openCatalog({ dataDir: dataDir.substring(0, dataDir.lastIndexOf("\\")) })).catalog;
    knowledge = new KnowledgeRepository(catalog.repository);
    expect(knowledge.revision(p.id, first.entryId, first.id)).toEqual(first);
    expect(knowledge.create(p.id, fields(), requestId)).toEqual(first);
    expect(knowledge.list(p.id, { limit: 20, offset: 0, q: "", status: "all" }).total).toBe(1);
  });

  it("confirms a new revision, then editing defaults back to draft", () => {
    const p = product();
    const draft = knowledge.create(p.id, fields());
    const approved = knowledge.save(p.id, draft.entryId, { ...fields(), status: "approved", baseRevisionId: draft.id });
    expect(approved).toMatchObject({ revisionNumber: 2, status: "approved" });
    const edited = knowledge.save(p.id, draft.entryId, { ...fields({ content: "600 ml" }), baseRevisionId: approved.id });
    expect(edited).toMatchObject({ revisionNumber: 3, status: "draft", content: "600 ml" });
  });

  it("archives a current revision and reports it stale", () => {
    const p = product();
    const draft = knowledge.create(p.id, fields());
    const approved = knowledge.save(p.id, draft.entryId, { ...fields(), status: "approved", baseRevisionId: draft.id });
    expect(knowledge.staleReasons(p.id, [{ entryId: approved.entryId, revisionId: approved.id, title: approved.title, content: approved.content, source: approved.source, kind: approved.kind }])).toEqual([]);
    const archived = knowledge.save(p.id, draft.entryId, { ...fields({ status: "archived" }), baseRevisionId: approved.id });
    expect(archived.status).toBe("archived");
    expect(knowledge.staleReasons(p.id, [{ entryId: approved.entryId, revisionId: approved.id, title: approved.title, content: approved.content, source: approved.source, kind: approved.kind }])).toEqual(["KNOWLEDGE_UPDATED", "KNOWLEDGE_ARCHIVED"]);
    expect(knowledge.staleReasons(p.id, [{ entryId: archived.entryId, revisionId: archived.id, title: archived.title, content: archived.content, source: archived.source, kind: archived.kind }])).toEqual(["KNOWLEDGE_ARCHIVED"]);
  });

  it("isolates products and rejects an old head", () => {
    const a = product("SKU-A"), b = product("SKU-B");
    const item = knowledge.create(a.id, fields());
    expect(() => knowledge.revision(b.id, item.entryId, item.id)).toThrowError(expect.objectContaining({ code: "KNOWLEDGE_ENTRY_NOT_FOUND" }));
    expect(() => knowledge.save(a.id, item.entryId, { ...fields({ content: "changed" }), baseRevisionId: "00000000-0000-4000-8000-000000000000" }))
      .toThrowError(expect.objectContaining({ code: "KNOWLEDGE_REVISION_CONFLICT" }));
    expect(knowledge.list(b.id, { limit: 20, offset: 0, q: "", status: "all" }).total).toBe(0);
  });

  it("returns a no-op for identical input and preserves history", () => {
    const p = product();
    const item = knowledge.create(p.id, fields());
    const same = knowledge.save(p.id, item.entryId, { ...fields(), baseRevisionId: item.id });
    expect(same).toEqual(item);
    expect(knowledge.history(p.id, item.entryId, { limit: 20, offset: 0 })).toMatchObject({ total: 1, items: [item] });
  });

  it("escapes wildcard characters in keyword searches", () => {
    const p = product();
    knowledge.create(p.id, fields({ title: "USB_Adapter", content: "A% special cable" }));
    knowledge.create(p.id, fields({ title: "Plain", content: "ordinary" }));
    expect(knowledge.list(p.id, { limit: 20, offset: 0, q: "USB_", status: "all" }).items.map(item => item.title)).toEqual(["USB_Adapter"]);
    expect(knowledge.list(p.id, { limit: 20, offset: 0, q: "%", status: "all" }).items.map(item => item.title)).toEqual(["USB_Adapter"]);
  });

  it("resolves only current approved revisions, deduplicated and capped", () => {
    const p = product();
    const first = knowledge.create(p.id, fields());
    const approved = knowledge.save(p.id, first.entryId, { ...fields(), status: "approved", baseRevisionId: first.id });
    const other = knowledge.create(p.id, fields({ title: "Brand", kind: "brand", status: "approved" }));
    const evidence = knowledge.resolveEvidence(p.id, [approved.id, approved.id, other.id]);
    expect(evidence).toEqual([
      { entryId: approved.entryId, revisionId: approved.id, title: approved.title, content: approved.content, source: approved.source, kind: approved.kind },
      { entryId: other.entryId, revisionId: other.id, title: other.title, content: other.content, source: other.source, kind: other.kind },
    ]);
    expect(() => knowledge.resolveEvidence(p.id, [first.id])).toThrowError(expect.objectContaining({ code: "KNOWLEDGE_NOT_APPROVED" }));
  });

  it("reopens the real SQLite database with immutable revisions and history intact", async () => {
    const p = product();
    const item = knowledge.create(p.id, fields());
    const dataDir = catalog.repository.db.name;
    catalog.close();
    catalog = (await openCatalog({ dataDir: dataDir.substring(0, dataDir.lastIndexOf("\\")) })).catalog;
    knowledge = new KnowledgeRepository(catalog.repository);
    expect(knowledge.revision(p.id, item.entryId, item.id)).toEqual(item);
    expect(knowledge.history(p.id, item.entryId, { limit: 20, offset: 0 }).total).toBe(1);
    expect(() => knowledge.db.prepare("UPDATE knowledge_revisions SET content='mutated' WHERE id=?").run(item.id)).toThrow("immutable");
  });
});

describe("knowledge HTTP routes", () => {
  it("returns 503 without catalog and enforces origin, media type, and schema", async () => {
    expect((await createKnowledgeRoutes().request("/00000000-0000-4000-8000-000000000000/knowledge")).status).toBe(503);
    const p = product();
    const app = createKnowledgeRoutes(catalog);
    const path = `/${p.id}/knowledge`;
    expect((await app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.invalid" }, body: JSON.stringify(fields()) })).status).toBe(403);
    expect((await app.request(path, { method: "POST", body: JSON.stringify(fields()) })).status).toBe(415);
    expect((await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields(), unknown: true }) })).status).toBe(422);
    expect((await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields(), padding: "x".repeat(8 * 1024 * 1024) }) })).status).toBe(413);
    const created = await app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify(fields()) });
    expect(created.status).toBe(201);
    expect((await app.request(path)).status).toBe(200);
  });

  it("accepts a request key and returns the same revision on replay", async () => {
    const p = product();
    const app = createKnowledgeRoutes(catalog);
    const path = `/${p.id}/knowledge`;
    const requestId = randomUUID();
    const headers = { "content-type": "application/json", origin: "http://localhost:5173" };
    const first = await app.request(path, { method: "POST", headers, body: JSON.stringify({ ...fields(), requestId }) });
    const replay = await app.request(path, { method: "POST", headers, body: JSON.stringify({ ...fields(), requestId }) });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await first.json()).toEqual(await replay.json());
    const conflict = await app.request(path, { method: "POST", headers, body: JSON.stringify({ ...fields({ content: "changed" }), requestId }) });
    expect(conflict.status).toBe(409);
    expect((await (await app.request(path)).json() as { total: number }).total).toBe(1);
  });
});
