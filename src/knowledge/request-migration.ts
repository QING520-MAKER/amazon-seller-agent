/**
 * Ordered migration after knowledge migration v3. The primary migration
 * runner owns the version number; this SQL is exported separately so v3 stays
 * byte-for-byte compatible and upgrade fixtures can apply it explicitly.
 */
export const knowledgeCreateRequestMigrationSQL = [
  "CREATE TABLE knowledge_create_requests (",
  " product_id TEXT NOT NULL REFERENCES products(id),",
  " request_id TEXT NOT NULL, input_hash TEXT NOT NULL,",
  " entry_id TEXT NOT NULL, revision_id TEXT NOT NULL, created_at TEXT NOT NULL,",
  " PRIMARY KEY(product_id, request_id),",
  " FOREIGN KEY(product_id, entry_id) REFERENCES knowledge_entries(product_id, id),",
  " FOREIGN KEY(product_id, entry_id, revision_id) REFERENCES knowledge_revisions(product_id, entry_id, id)",
  ");",
  "CREATE INDEX knowledge_create_requests_entry ON knowledge_create_requests(product_id, entry_id);",
  "CREATE TRIGGER knowledge_create_requests_no_update BEFORE UPDATE ON knowledge_create_requests BEGIN SELECT RAISE(ABORT, 'knowledge create request is immutable'); END;",
  "CREATE TRIGGER knowledge_create_requests_no_delete BEFORE DELETE ON knowledge_create_requests BEGIN SELECT RAISE(ABORT, 'knowledge create request cannot be deleted'); END;",
].join("\n");
