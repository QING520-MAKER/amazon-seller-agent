import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate, catalogV1MigrationSQL, CURRENT_SCHEMA_VERSION } from "../src/storage/migrations.js";
import { CatalogRepository } from "../src/catalog/repository.js";
import { CreateProductSchema } from "../src/schemas.js";

async function historicalDatabase() {
  const dir = await mkdtemp("E:\\CodexTemp\\asa-v1-upgrade-");
  const db = new Database(join(dir, "catalog.sqlite"));
  db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.exec(catalogV1MigrationSQL);
  db.prepare("INSERT INTO schema_migrations VALUES(1, ?)").run("2026-09-20T00:00:00.000Z");
  db.pragma("user_version=1");
  const repository = new CatalogRepository(db);
  const product = repository.create(CreateProductSchema.parse({ sku: "PRE-UPGRADE", brief: { name: "Real data before upgrade", attributes: ["500 ml"] }, sourceNote: "Manual v1" }));
  return { db, repository, product };
}
describe("ordered studio migration from a real v1 database", () => {
  it("applies every missing version atomically and preserves prior records across reopening", async () => {
    const { db, repository, product } = await historicalDatabase();
    const path = db.name;
    try {
      migrate(db);
      expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
      expect(repository.detail(product.product.id)).toEqual(product);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => ({ version: i + 1 })));
      migrate(db);
      expect(repository.revisions(product.product.id, { limit: 20, offset: 0 }).total).toBe(1);
    } finally { db.close(); }
    const reopened = new Database(path);
    try { expect(new CatalogRepository(reopened).detail(product.product.id)).toEqual(product); }
    finally { reopened.close(); }
  });
  it("rolls back all pending migrations if a later migration cannot apply", async () => {
    const { db, repository, product } = await historicalDatabase();
    try {
      db.exec("CREATE TABLE knowledge_entries(conflict TEXT)");
      expect(() => migrate(db)).toThrow();
      expect(db.pragma("user_version", { simple: true })).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='content_versions'").get()).toBeUndefined();
      expect(repository.detail(product.product.id)).toEqual(product);
      expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    } finally { db.close(); }
  });
});
