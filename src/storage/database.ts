import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { StorageSettings } from "./settings.js";
import { migrate } from "./migrations.js";

export function openDatabase(settings: StorageSettings): Database.Database {
  mkdirSync(settings.dataDir, { recursive: true });
  const db = new Database(join(settings.dataDir, "catalog.sqlite"), { timeout: 3000 });
  try {
    db.pragma("foreign_keys = ON");
    migrate(db);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    return db;
  } catch (error) { db.close(); throw error; }
}

export function closeDatabase(db: Database.Database) {
  try { db.pragma("wal_checkpoint(TRUNCATE)"); }
  finally { db.close(); }
}
