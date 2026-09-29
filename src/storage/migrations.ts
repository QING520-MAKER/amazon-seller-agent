import type Database from "better-sqlite3";
import { knowledgeMigrationSQL } from "../knowledge/migration.js";
import { knowledgeCreateRequestMigrationSQL } from "../knowledge/request-migration.js";
import { batchMigrationSQL } from "../batch/migration.js";
import { imageMigrationSQL } from "../image/migration.js";
import { packageMigrationSQL } from "../packages/migration.js";

const initial = [
  "CREATE TABLE products (",
  " id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL CHECK(workspace_id='local'),",
  " sku TEXT NOT NULL COLLATE BINARY, current_revision_id TEXT NOT NULL,",
  " created_at TEXT NOT NULL, updated_at TEXT NOT NULL,",
  " UNIQUE(workspace_id, sku),",
  " FOREIGN KEY(id, current_revision_id) REFERENCES product_revisions(product_id, id) DEFERRABLE INITIALLY DEFERRED",
  ");",
  "CREATE TABLE product_revisions (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),",
  " revision_number INTEGER NOT NULL CHECK(revision_number >= 1),",
  " brief_json TEXT NOT NULL CHECK(json_valid(brief_json)), source_note TEXT NOT NULL, created_at TEXT NOT NULL,",
  " UNIQUE(product_id, revision_number), UNIQUE(product_id, id)",
  ");",
  "CREATE TABLE original_assets (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),",
  " original_name TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),",
  " size_bytes INTEGER NOT NULL CHECK(size_bytes > 0), width INTEGER NOT NULL CHECK(width > 0), height INTEGER NOT NULL CHECK(height > 0),",
  " orientation INTEGER CHECK(orientation BETWEEN 1 AND 8), sha256 TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,",
  " created_at TEXT NOT NULL, archived_at TEXT, version INTEGER NOT NULL CHECK(version >= 1),",
  " UNIQUE(product_id, sha256)",
  ");",
  "CREATE INDEX products_updated ON products(updated_at DESC, id DESC);",
  "CREATE INDEX assets_product_state ON original_assets(product_id, archived_at, created_at DESC, id DESC);",
  "CREATE TRIGGER revisions_no_update BEFORE UPDATE ON product_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;",
  "CREATE TRIGGER revisions_no_delete BEFORE DELETE ON product_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;",
  "CREATE TRIGGER assets_core_immutable BEFORE UPDATE OF id,product_id,original_name,mime_type,size_bytes,width,height,orientation,sha256,storage_key,created_at ON original_assets BEGIN SELECT RAISE(ABORT, 'immutable original'); END;",
  "CREATE TRIGGER assets_no_delete BEFORE DELETE ON original_assets BEGIN SELECT RAISE(ABORT, 'originals are archived only'); END;",
  "CREATE TRIGGER products_identity_immutable BEFORE UPDATE OF id,workspace_id,sku,created_at ON products BEGIN SELECT RAISE(ABORT, 'immutable product identity'); END;",
  "CREATE TRIGGER products_no_delete BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT, 'products cannot be deleted'); END;",
].join("\n");

/** Historical v1 DDL, exposed for real upgrade-fixture verification. */
export const catalogV1MigrationSQL = initial;

// Keep the v1 DDL above byte-for-byte stable. Content studio tables are added
// by an ordered migration so existing products and originals remain intact.
const contentStudio = [
  "CREATE TABLE content_versions (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),",
  " source_revision_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number >= 1),",
  " parent_version_id TEXT, marketplace TEXT NOT NULL CHECK(marketplace='us'), language TEXT NOT NULL CHECK(language='en_US'),",
  " keywords_json TEXT NOT NULL CHECK(json_valid(keywords_json)), copy_json TEXT NOT NULL CHECK(json_valid(copy_json)),",
  " coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json)), evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),",
  " rules_version TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('template','model','manual')), model TEXT,",
  " generation_run_id TEXT, created_at TEXT NOT NULL,",
  " UNIQUE(product_id, id), UNIQUE(product_id, marketplace, language, version_number),",
  " FOREIGN KEY(product_id, source_revision_id) REFERENCES product_revisions(product_id, id),",
  " FOREIGN KEY(product_id, parent_version_id) REFERENCES content_versions(product_id, id)",
  ");",
  "CREATE TRIGGER content_versions_no_update BEFORE UPDATE ON content_versions BEGIN SELECT RAISE(ABORT, 'content version is immutable'); END;",
  "CREATE TRIGGER content_versions_no_delete BEFORE DELETE ON content_versions BEGIN SELECT RAISE(ABORT, 'content versions are immutable'); END;",
  "CREATE INDEX content_versions_product ON content_versions(product_id, marketplace, language, version_number DESC);",
  "CREATE TABLE content_heads (",
  " product_id TEXT NOT NULL REFERENCES products(id), marketplace TEXT NOT NULL CHECK(marketplace='us'), language TEXT NOT NULL CHECK(language='en_US'),",
  " head_version_id TEXT,",
  " PRIMARY KEY(product_id, marketplace, language),",
  " FOREIGN KEY(product_id, head_version_id) REFERENCES content_versions(product_id, id)",
  ");",
  "CREATE TABLE content_runs (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,",
  " source_revision_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('template','model')),",
  " input_hash TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),",
  " status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),",
  " content_version_id TEXT, error_code TEXT, error_message TEXT, started_at TEXT NOT NULL, finished_at TEXT,",
  " UNIQUE(product_id, request_id),",
  " FOREIGN KEY(product_id, source_revision_id) REFERENCES product_revisions(product_id, id),",
  " FOREIGN KEY(product_id, content_version_id) REFERENCES content_versions(product_id, id)",
  ");",
  "CREATE INDEX content_runs_product ON content_runs(product_id, started_at DESC);",
  "CREATE TABLE content_reviews (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), content_version_id TEXT NOT NULL,",
  " decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), notes TEXT NOT NULL, created_at TEXT NOT NULL,",
  " FOREIGN KEY(product_id, content_version_id) REFERENCES content_versions(product_id, id)",
  ");",
  "CREATE TRIGGER content_reviews_no_update BEFORE UPDATE ON content_reviews BEGIN SELECT RAISE(ABORT, 'content review is immutable'); END;",
  "CREATE TRIGGER content_reviews_no_delete BEFORE DELETE ON content_reviews BEGIN SELECT RAISE(ABORT, 'content reviews are immutable'); END;",
  "CREATE INDEX content_reviews_version ON content_reviews(product_id, content_version_id, created_at DESC);",
].join("\n");

const migrations: Record<number, string> = { 1: initial, 2: contentStudio, 3: knowledgeMigrationSQL, 4: batchMigrationSQL, 5: imageMigrationSQL, 6: packageMigrationSQL, 7: knowledgeCreateRequestMigrationSQL };
export const CURRENT_SCHEMA_VERSION = 7;

function validateMigrationHistory(db: Database.Database, versions: { version: number }[], pragmaVersion: number) {
  if (!versions.length || pragmaVersion !== versions[versions.length - 1]!.version) {
    throw new Error("不支持此数据库迁移版本；原有数据保持不变。");
  }
  for (let index = 0; index < versions.length; index++) {
    if (versions[index]!.version !== index + 1 || !migrations[versions[index]!.version]) {
      throw new Error("不支持此数据库迁移版本；原有数据保持不变。");
    }
  }
}

export function migrate(db: Database.Database) {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (hasTable) {
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
    validateMigrationHistory(db, versions, db.pragma("user_version", { simple: true }) as number);
    if (versions.length === CURRENT_SCHEMA_VERSION) return;
    db.transaction(() => {
      for (let next = versions.length + 1; next <= CURRENT_SCHEMA_VERSION; next++) {
        db.exec(migrations[next]!);
        db.prepare("INSERT INTO schema_migrations VALUES(?, ?)").run(next, new Date().toISOString());
        db.pragma("user_version = " + next);
      }
    }).immediate();
    return;
  }
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || db.pragma("user_version", { simple: true }) !== 0) throw new Error("未识别的已有数据库，拒绝重建。");
  db.transaction(() => {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (let next = 1; next <= CURRENT_SCHEMA_VERSION; next++) {
      db.exec(migrations[next]!);
      db.prepare("INSERT INTO schema_migrations VALUES(?, ?)").run(next, new Date().toISOString());
      db.pragma("user_version = " + next);
    }
  }).immediate();
}
