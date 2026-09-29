/** Ordered DDL for the S5 batch slice.
 *
 * The application migration owns the version number. Tests and development
 * callers may apply this DDL after opening a v2 catalog until that migration
 * is wired into the catalog startup.
 */
export const batchMigrationSQL = [
  "CREATE TABLE content_batches (",
  " id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, input_hash TEXT NOT NULL,",
  " input_json TEXT NOT NULL CHECK(json_valid(input_json)),",
  " items_json TEXT NOT NULL CHECK(json_valid(items_json)),",
  " status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','partial','failed','interrupted')),",
  " created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,",
  " error_code TEXT, error_message TEXT",
  ");",
  "CREATE INDEX content_batches_created ON content_batches(created_at DESC, id DESC);",
  "CREATE INDEX content_batches_status ON content_batches(status, updated_at DESC);",
  "CREATE TRIGGER content_batches_input_immutable BEFORE UPDATE OF id,request_id,input_hash,input_json,created_at ON content_batches BEGIN SELECT RAISE(ABORT, 'batch input is immutable'); END;",
].join("\n");
