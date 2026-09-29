/**
 * Knowledge migration 1. The primary migration runner should execute this
 * whole script once after the content-studio migration. It is deliberately
 * separate from the catalog migration so knowledge can be introduced in order
 * without rewriting the existing migration history.
 */
export const knowledgeMigrationSQL = [
  "CREATE TABLE knowledge_entries (",
  " id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),",
  " current_revision_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,",
  " UNIQUE(product_id, id),",
  " FOREIGN KEY(product_id, id, current_revision_id) REFERENCES knowledge_revisions(product_id, entry_id, id) DEFERRABLE INITIALLY DEFERRED",
  ");",
  "CREATE TABLE knowledge_revisions (",
  " id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),",
  " revision_number INTEGER NOT NULL CHECK(revision_number >= 1),",
  " kind TEXT NOT NULL CHECK(kind IN ('product_fact','brand','platform_rule','reference')),",
  " title TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL,",
  " status TEXT NOT NULL CHECK(status IN ('draft','approved','archived')), created_at TEXT NOT NULL,",
  " UNIQUE(product_id, id), UNIQUE(product_id, entry_id, id), UNIQUE(entry_id, revision_number),",
  " FOREIGN KEY(product_id, entry_id) REFERENCES knowledge_entries(product_id, id) DEFERRABLE INITIALLY DEFERRED",
  ");",
  "CREATE INDEX knowledge_entries_product_updated ON knowledge_entries(product_id, updated_at DESC, id DESC);",
  "CREATE INDEX knowledge_revisions_product_created ON knowledge_revisions(product_id, created_at DESC, id DESC);",
  "CREATE INDEX knowledge_revisions_entry_number ON knowledge_revisions(entry_id, revision_number DESC, id DESC);",
  "CREATE TRIGGER knowledge_revisions_no_update BEFORE UPDATE ON knowledge_revisions BEGIN SELECT RAISE(ABORT, 'immutable knowledge revision'); END;",
  "CREATE TRIGGER knowledge_revisions_no_delete BEFORE DELETE ON knowledge_revisions BEGIN SELECT RAISE(ABORT, 'knowledge revisions are immutable'); END;",
  "CREATE TRIGGER knowledge_entries_identity_immutable BEFORE UPDATE OF id, product_id, created_at ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'immutable knowledge entry identity'); END;",
  "CREATE TRIGGER knowledge_entries_no_delete BEFORE DELETE ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'knowledge entries cannot be deleted'); END;",
].join("\n");
