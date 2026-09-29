export const packageMigrationSQL = `
CREATE TABLE content_packages (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  content_version_id TEXT NOT NULL, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_at TEXT NOT NULL,
  UNIQUE(product_id, request_id), UNIQUE(product_id, version_number),
  FOREIGN KEY(product_id, content_version_id) REFERENCES content_versions(product_id, id)
);
CREATE TRIGGER packages_no_update BEFORE UPDATE ON content_packages BEGIN SELECT RAISE(ABORT, 'immutable package'); END;
CREATE TRIGGER packages_no_delete BEFORE DELETE ON content_packages BEGIN SELECT RAISE(ABORT, 'immutable package'); END;
`;
