import type { DaliDatabase } from "../db/client.js";
import type { OllamaEmbedder } from "../embeddings/ollama.js";
import type {
  Memory,
  MemoryRow,
  MemoryType,
  SearchResult,
} from "../types.js";

export class MemorySearch {
  constructor(
    private db: DaliDatabase,
    private embedder: OllamaEmbedder
  ) {}

  async search(
    query: string,
    limit: number = 10,
    project?: string,
    minRelevance: number = 0.3,
    boostProject?: string
  ): Promise<SearchResult[]> {
    const embedding = await this.embedder.embed(query);
    const knnLimit = limit * 3; // Fetch extra for post-filtering

    // CTE approach: vec0 KNN first, then join to memories
    // Cosine distance: 0 = identical, 2 = opposite
    // Relevance = 1 - (distance / 2) → maps to 0..1
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

    const rows = this.db.db.prepare(sql).all(...params) as Array<
      MemoryRow & { relevance: number }
    >;

    const results = rows
      .filter((r) => r.relevance >= minRelevance)
      .slice(0, limit)
      .map((r) => ({
        memory: this.rowToMemory(r),
        relevance: Math.round(r.relevance * 1000) / 1000,
      }));

    if (boostProject) {
      for (const r of results) {
        if (r.memory.project === boostProject) {
          r.relevance = Math.min(1.0, Math.round(r.relevance * 1.15 * 1000) / 1000);
        }
      }
      results.sort((a, b) => b.relevance - a.relevance);
    }

    return results;
  }

  searchByType(
    type: MemoryType,
    query?: string,
    limit: number = 20,
    project?: string
  ): SearchResult[] | Memory[] {
    if (query) {
      // Text-based filtering with LIKE
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

      const rows = this.db.db.prepare(sql).all(...params) as MemoryRow[];
      return rows.map((r) => this.rowToMemory(r));
    }

    let sql = "SELECT * FROM memories WHERE type = ? AND archived = 0";
    const params: unknown[] = [type];

    if (project) {
      sql += " AND project = ?";
      params.push(project);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  listRecent(
    limit: number = 20,
    type?: MemoryType,
    project?: string
  ): Memory[] {
    let sql = "SELECT * FROM memories WHERE archived = 0";
    const params: unknown[] = [];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }

    if (project) {
      sql += " AND project = ?";
      params.push(project);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getSessionMemories(sessionId: string): Memory[] {
    const rows = this.db.db
      .prepare(
        "SELECT * FROM memories WHERE session_id = ? AND archived = 0 ORDER BY created_at ASC"
      )
      .all(sessionId) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      type: row.type as Memory["type"],
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
}
