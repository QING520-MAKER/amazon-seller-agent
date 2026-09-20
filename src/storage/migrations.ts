import type Database from "better-sqlite3";

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

export function migrate(db: Database.Database) {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (hasTable) {
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
    if (versions.length !== 1 || versions[0]?.version !== 1 || db.pragma("user_version", { simple: true }) !== 1) {
      throw new Error("不支持此数据库迁移版本；原有数据保持不变。");
    }
    return;
  }
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || db.pragma("user_version", { simple: true }) !== 0) throw new Error("未识别的已有数据库，拒绝重建。");
  db.transaction(() => {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    db.exec(initial);
    db.prepare("INSERT INTO schema_migrations VALUES(1, ?)").run(new Date().toISOString());
    db.pragma("user_version = 1");
  }).immediate();
}
