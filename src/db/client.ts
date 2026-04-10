import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DDL, SCHEMA_VERSION } from "./schema.js";

export class DaliDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Enable WAL mode for concurrent reads
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.runMigrations();
  }

  private runMigrations(): void {
    // Check if schema_version table exists
    const hasVersionTable = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      )
      .get();

    if (!hasVersionTable) {
      // Fresh database — run all DDL
      this.db.transaction(() => {
        for (const statement of DDL) {
          this.db.exec(statement);
        }
        this.db
          .prepare("INSERT INTO schema_version (version) VALUES (?)")
          .run(SCHEMA_VERSION);
      })();
      return;
    }

    const row = this.db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;

    if (!row || row.version < SCHEMA_VERSION) {
      // Future: run incremental migrations here
      this.db
        .prepare("UPDATE schema_version SET version = ?")
        .run(SCHEMA_VERSION);
    }
  }

  close(): void {
    this.db.close();
  }
}
