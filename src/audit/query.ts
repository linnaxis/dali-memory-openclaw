import type { DaliDatabase } from "../db/client.js";
import type { AuditLogEntry, GetAuditLogInput } from "../types.js";

export class AuditQuery {
  constructor(private db: DaliDatabase) {}

  query(input: GetAuditLogInput): { entries: AuditLogEntry[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.action_type) {
      conditions.push("action_type = ?");
      params.push(input.action_type);
    }
    if (input.tool_name) {
      conditions.push("tool_name = ?");
      params.push(input.tool_name);
    }
    if (input.session_id) {
      conditions.push("session_id = ?");
      params.push(input.session_id);
    }
    if (input.since) {
      conditions.push("timestamp >= ?");
      params.push(input.since);
    }
    if (input.until) {
      conditions.push("timestamp <= ?");
      params.push(input.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countRow = this.db.db
      .prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`)
      .get(...params) as { count: number };

    // Get paginated results
    const entries = this.db.db
      .prepare(
        `SELECT * FROM audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...params, input.limit ?? 50, input.offset ?? 0) as AuditLogEntry[];

    return { entries, total: countRow.count };
  }
}
