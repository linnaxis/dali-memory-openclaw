import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

// Re-export for search/store modules
export type { Database as BetterSqlite3Database } from "better-sqlite3";

export type MemoryType = "conversation" | "decision" | "file_change" | "tool_usage";

export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  session_id: string | null;
  project: string | null;
  tags: string; // JSON
  metadata: string; // JSON
  created_at: string;
  archived: number;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string | null;
  session_id: string | null;
  project: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  archived: boolean;
}

export interface SearchResult {
  memory: Memory;
  relevance: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    summary: row.summary,
    session_id: row.session_id,
    project: row.project,
    tags: JSON.parse(row.tags),
    metadata: JSON.parse(row.metadata),
    created_at: row.created_at,
    archived: row.archived === 1,
  };
}

function resolveDbPath(dbPath: string): string {
  if (dbPath.startsWith("~")) {
    return path.join(process.env.HOME ?? "", dbPath.slice(1));
  }
  return dbPath;
}

/**
 * Read-only client for Dali's SQLite vector DB.
 * Opens the DB read-only with sqlite-vec extension loaded.
 */
export class DaliReadonlyDB {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  open(): boolean {
    const resolved = resolveDbPath(this.dbPath);
    if (!fs.existsSync(resolved)) {
      return false;
    }
    try {
      this.db = new Database(resolved, { readonly: true });
      sqliteVec.load(this.db);
      return true;
    } catch {
      this.db = null;
      return false;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * KNN vector search — reuses exact SQL from Dali's search.ts
   * Cosine distance: 0 = identical, 2 = opposite
   * Relevance = 1 - (distance / 2) → maps to 0..1
   */
  search(
    embedding: number[],
    limit: number = 10,
    minRelevance: number = 0.3,
    project?: string,
  ): SearchResult[] {
    if (!this.db) {
      return [];
    }

    const knnLimit = limit * 3;

    const sql = `
      WITH knn AS (
        SELECT rowid, distance
        FROM memory_embeddings
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      )
      SELECT
        m.*,
        1.0 - (knn.distance / 2.0) AS relevance
      FROM knn
      JOIN memory_vec_map v ON v.rowid = knn.rowid
      JOIN memories m ON m.id = v.memory_id
      WHERE m.archived = 0
      ${project ? "AND m.project = ?" : ""}
      ORDER BY knn.distance ASC
    `;

    const params: unknown[] = [new Float32Array(embedding), knnLimit];
    if (project) {
      params.push(project);
    }

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<MemoryRow & { relevance: number }>;

      return rows
        .filter((r) => r.relevance >= minRelevance)
        .slice(0, limit)
        .map((r) => ({
          memory: rowToMemory(r),
          relevance: Math.round(r.relevance * 1000) / 1000,
        }));
    } catch {
      return [];
    }
  }

  searchByType(
    type: MemoryType,
    query: string | undefined,
    limit: number = 20,
    project?: string,
  ): Memory[] {
    if (!this.db) {
      return [];
    }

    if (query) {
      let sql = `
        SELECT * FROM memories
        WHERE type = ? AND archived = 0
          AND (content LIKE ? OR summary LIKE ? OR tags LIKE ?)
      `;
      const pattern = `%${query}%`;
      const params: unknown[] = [type, pattern, pattern, pattern];

      if (project) {
        sql += " AND project = ?";
        params.push(project);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      try {
        const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
        return rows.map(rowToMemory);
      } catch {
        return [];
      }
    }

    let sql = "SELECT * FROM memories WHERE type = ? AND archived = 0";
    const params: unknown[] = [type];

    if (project) {
      sql += " AND project = ?";
      params.push(project);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
      return rows.map(rowToMemory);
    } catch {
      return [];
    }
  }
}

/**
 * Read-write client for storing memories into Dali's SQLite DB.
 * Opens a separate connection with write access.
 */
export class DaliWritableDB {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  open(): boolean {
    const resolved = resolveDbPath(this.dbPath);
    if (!fs.existsSync(resolved)) {
      return false;
    }
    try {
      this.db = new Database(resolved);
      sqliteVec.load(this.db);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      return true;
    } catch {
      this.db = null;
      return false;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  store(input: {
    type: MemoryType;
    content: string;
    summary?: string;
    session_id?: string;
    project?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): string | null {
    if (!this.db) {
      return null;
    }

    const id = randomUUID();
    const tags = JSON.stringify(input.tags ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, summary, session_id, project, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.content,
        input.summary ?? null,
        input.session_id ?? null,
        input.project ?? null,
        tags,
        metadata,
      );

    return id;
  }

  insertEmbedding(memoryId: string, embedding: number[]): void {
    if (!this.db) {
      return;
    }

    this.db.transaction(() => {
      this.db!.prepare("INSERT INTO memory_vec_map (memory_id) VALUES (?)").run(memoryId);

      const vecRow = this.db!.prepare(
        "SELECT rowid FROM memory_vec_map WHERE memory_id = ?",
      ).get(memoryId) as { rowid: number };

      this.db!.prepare("INSERT INTO memory_embeddings (rowid, embedding) VALUES (?, ?)").run(
        BigInt(vecRow.rowid),
        new Float32Array(embedding),
      );
    })();
  }
}
