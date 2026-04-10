import type { DaliDatabase } from "../db/client.js";

const MAX_OUTPUT_LENGTH = 10000;

export class AuditLogger {
  constructor(private db: DaliDatabase) {}

  log(entry: {
    action_type: string;
    tool_name?: string;
    input?: unknown;
    output?: unknown;
    session_id?: string;
    duration_ms?: number;
  }): void {
    const inputStr = entry.input != null ? JSON.stringify(entry.input) : null;
    let outputStr = entry.output != null ? JSON.stringify(entry.output) : null;

    // Truncate large outputs
    if (outputStr && outputStr.length > MAX_OUTPUT_LENGTH) {
      outputStr = outputStr.slice(0, MAX_OUTPUT_LENGTH) + "...[truncated]";
    }

    this.db.db
      .prepare(
        `INSERT INTO audit_log (action_type, tool_name, input, output, session_id, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.action_type,
        entry.tool_name ?? null,
        inputStr,
        outputStr,
        entry.session_id ?? null,
        entry.duration_ms ?? null
      );
  }
}
