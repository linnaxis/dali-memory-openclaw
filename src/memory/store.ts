import { v4 as uuidv4 } from "uuid";
import type { DaliDatabase } from "../db/client.js";
import type { OllamaEmbedder } from "../embeddings/ollama.js";
import type { Memory, MemoryRow, StoreMemoryInput } from "../types.js";

export class MemoryStore {
  constructor(
    private db: DaliDatabase,
    private embedder: OllamaEmbedder
  ) {}

  async store(input: StoreMemoryInput): Promise<Memory> {
    const id = uuidv4();
    const tags = JSON.stringify(input.tags ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db.db
      .prepare(
        `INSERT INTO memories (id, type, content, summary, session_id, project, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.type,
        input.content,
        input.summary ?? null,
        input.session_id ?? null,
        input.project ?? null,
        tags,
        metadata
      );

    // Store file change record if applicable
    if (input.type === "file_change" && input.file_path) {
      this.db.db
        .prepare(
          `INSERT INTO file_changes (memory_id, file_path, change_type, diff_summary, lines_added, lines_removed)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.file_path,
          input.change_type ?? "modify",
          input.diff_summary ?? null,
          input.lines_added ?? 0,
          input.lines_removed ?? 0
        );
    }

    // Generate and store embedding (graceful degradation)
    try {
      const textToEmbed = input.summary
        ? `${input.summary}\n\n${input.content}`
        : input.content;
      const embedding = await this.embedder.embed(textToEmbed);
      this.insertEmbedding(id, embedding);
    } catch {
      // Ollama unavailable — embedding will be backfilled later
    }

    return this.getById(id)!;
  }

  private insertEmbedding(memoryId: string, embedding: number[]): void {
    this.db.db.transaction(() => {
      // Insert into bridge table to get integer rowid
      this.db.db
        .prepare("INSERT INTO memory_vec_map (memory_id) VALUES (?)")
        .run(memoryId);

      const rowid = (
        this.db.db
          .prepare(
            "SELECT rowid FROM memory_vec_map WHERE memory_id = ?"
          )
          .get(memoryId) as { rowid: number }
      ).rowid;

      // Insert into vec0 virtual table — rowid must be BigInt for sqlite-vec
      this.db.db
        .prepare(
          "INSERT INTO memory_embeddings (rowid, embedding) VALUES (?, ?)"
        )
        .run(BigInt(rowid), new Float32Array(embedding));
    })();
  }

  getById(id: string): Memory | null {
    const row = this.db.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRow | undefined;

    return row ? this.rowToMemory(row) : null;
  }

  archive(id: string): boolean {
    const result = this.db.db
      .prepare("UPDATE memories SET archived = 1 WHERE id = ? AND archived = 0")
      .run(id);
    return result.changes > 0;
  }

  permanentDelete(id: string): boolean {
    const result = this.db.db.transaction(() => {
      // Get vec map rowid if it exists
      const vecRow = this.db.db
        .prepare("SELECT rowid FROM memory_vec_map WHERE memory_id = ?")
        .get(id) as { rowid: number } | undefined;

      if (vecRow) {
        this.db.db
          .prepare("DELETE FROM memory_embeddings WHERE rowid = ?")
          .run(vecRow.rowid);
        this.db.db
          .prepare("DELETE FROM memory_vec_map WHERE memory_id = ?")
          .run(id);
      }

      this.db.db
        .prepare("DELETE FROM file_changes WHERE memory_id = ?")
        .run(id);
      return this.db.db
        .prepare("DELETE FROM memories WHERE id = ?")
        .run(id);
    })();

    return result.changes > 0;
  }

  async backfillEmbeddings(): Promise<number> {
    // Find memories that don't have embeddings
    const rows = this.db.db
      .prepare(
        `SELECT m.id, m.content, m.summary FROM memories m
         LEFT JOIN memory_vec_map v ON m.id = v.memory_id
         WHERE v.rowid IS NULL AND m.archived = 0`
      )
      .all() as Array<{ id: string; content: string; summary: string | null }>;

    if (rows.length === 0) return 0;

    const texts = rows.map((r) =>
      r.summary ? `${r.summary}\n\n${r.content}` : r.content
    );

    // Batch embed in chunks of 32
    let backfilled = 0;
    for (let i = 0; i < texts.length; i += 32) {
      const chunk = texts.slice(i, i + 32);
      const ids = rows.slice(i, i + 32).map((r) => r.id);

      try {
        const embeddings = await this.embedder.embedBatch(chunk);
        for (let j = 0; j < embeddings.length; j++) {
          this.insertEmbedding(ids[j], embeddings[j]);
          backfilled++;
        }
      } catch {
        break; // Ollama went down, stop backfilling
      }
    }

    return backfilled;
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
