/**
 * Image migration 1. The primary migration runner executes this script in
 * order after the catalog and knowledge migrations. Image files are kept in
 * the controlled filesystem; SQLite stores their immutable metadata and
 * provenance.
 */
export const imageMigrationSQL = [
  "CREATE TABLE image_versions (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),",
  " source_revision_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number >= 1),",
  " original_asset_id TEXT NOT NULL REFERENCES original_assets(id), original_asset_version INTEGER NOT NULL CHECK(original_asset_version >= 1),",
  " original_json TEXT NOT NULL CHECK(json_valid(original_json)), plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),",
  " evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), mode TEXT NOT NULL CHECK(mode IN ('local','model')),",
  " provider TEXT NOT NULL, model TEXT, mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),",
  " width INTEGER NOT NULL CHECK(width > 0), height INTEGER NOT NULL CHECK(height > 0), size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),",
  " sha256 TEXT NOT NULL, generation_run_id TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,",
  " UNIQUE(product_id, id), UNIQUE(product_id, version_number),",
  " FOREIGN KEY(product_id, source_revision_id) REFERENCES product_revisions(product_id, id),",
  " FOREIGN KEY(product_id, generation_run_id) REFERENCES image_runs(product_id, id) DEFERRABLE INITIALLY DEFERRED",
  ");",
  "CREATE TABLE image_runs (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,",
  " source_revision_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('local','model')), input_hash TEXT NOT NULL,",
  " input_json TEXT NOT NULL CHECK(json_valid(input_json)), status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),",
  " image_version_id TEXT, error_code TEXT, error_message TEXT, started_at TEXT NOT NULL, finished_at TEXT,",
  " UNIQUE(product_id, id), UNIQUE(product_id, request_id),",
  " FOREIGN KEY(product_id, source_revision_id) REFERENCES product_revisions(product_id, id),",
  " FOREIGN KEY(product_id, image_version_id) REFERENCES image_versions(product_id, id)",
  ");",
  "CREATE TABLE image_reviews (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), image_version_id TEXT NOT NULL,",
  " decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), notes TEXT NOT NULL, created_at TEXT NOT NULL,",
  " FOREIGN KEY(product_id, image_version_id) REFERENCES image_versions(product_id, id)",
  ");",
  "CREATE INDEX image_versions_product ON image_versions(product_id, version_number DESC, id DESC);",
  "CREATE INDEX image_runs_product ON image_runs(product_id, started_at DESC, id DESC);",
  "CREATE INDEX image_reviews_version ON image_reviews(product_id, image_version_id, created_at DESC, id DESC);",
  "CREATE TRIGGER image_versions_no_update BEFORE UPDATE ON image_versions BEGIN SELECT RAISE(ABORT, 'image version is immutable'); END;",
  "CREATE TRIGGER image_versions_no_delete BEFORE DELETE ON image_versions BEGIN SELECT RAISE(ABORT, 'image versions are immutable'); END;",
  "CREATE TRIGGER image_reviews_no_update BEFORE UPDATE ON image_reviews BEGIN SELECT RAISE(ABORT, 'image review is immutable'); END;",
  "CREATE TRIGGER image_reviews_no_delete BEFORE DELETE ON image_reviews BEGIN SELECT RAISE(ABORT, 'image reviews are immutable'); END;",
].join("\n");
