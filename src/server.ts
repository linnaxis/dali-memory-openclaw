import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DaliDatabase } from "./db/client.js";
import { OllamaEmbedder } from "./embeddings/ollama.js";
import { MemoryStore } from "./memory/store.js";
import { MemorySearch } from "./memory/search.js";
import { AuditLogger } from "./audit/logger.js";
import { AuditQuery } from "./audit/query.js";
import type {
  StoreMemoryInput,
  SearchMemoryInput,
  SearchByTypeInput,
  GetAuditLogInput,
  GetSessionSummaryInput,
  ListRecentMemoriesInput,
  ForgetMemoryInput,
  Session,
} from "./types.js";

export function createServer(dbPath: string, defaultProject?: string): McpServer {
  const db = new DaliDatabase(dbPath);
  const embedder = new OllamaEmbedder();
  const store = new MemoryStore(db, embedder);
  const search = new MemorySearch(db, embedder);
  const auditLogger = new AuditLogger(db);
  const auditQuery = new AuditQuery(db);

  const server = new McpServer(
    { name: "dali", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  // ── Tool: store_memory ──
  server.tool(
    "store_memory",
    "Store a memory (conversation, decision, file_change, or tool_usage) with automatic vector embedding for later semantic search",
    {
      type: z.enum(["conversation", "decision", "file_change", "tool_usage"]),
      content: z.string().describe("The memory content to store"),
      summary: z.string().optional().describe("Short summary of the memory"),
      session_id: z.string().optional().describe("Session ID to associate with"),
      project: z.string().optional().describe("Project name"),
      tags: z.array(z.string()).optional().default([]).describe("Tags for categorization"),
      metadata: z.record(z.unknown()).optional().default({}).describe("Arbitrary metadata"),
      file_path: z.string().optional().describe("File path (for file_change type)"),
      change_type: z.string().optional().describe("Change type: create/modify/delete (for file_change type)"),
      diff_summary: z.string().optional().describe("Summary of diff (for file_change type)"),
      lines_added: z.number().optional().default(0).describe("Lines added (for file_change type)"),
      lines_removed: z.number().optional().default(0).describe("Lines removed (for file_change type)"),
    },
    async (args) => {
      const start = Date.now();
      try {
        // Ensure session exists
        if (args.session_id) {
          ensureSession(db, args.session_id, args.project);
        }

        const input = { ...args, project: args.project ?? defaultProject };
        const memory = await store.store(input as StoreMemoryInput);
        const result = { content: [{ type: "text" as const, text: JSON.stringify(memory, null, 2) }] };

        auditLogger.log({
          action_type: "store_memory",
          tool_name: "store_memory",
          input: args,
          output: { id: memory.id, type: memory.type },
          session_id: args.session_id,
          duration_ms: Date.now() - start,
        });

        return result;
      } catch (err) {
        auditLogger.log({
          action_type: "store_memory_error",
          tool_name: "store_memory",
          input: args,
          output: { error: String(err) },
          session_id: args.session_id,
          duration_ms: Date.now() - start,
        });
        return { content: [{ type: "text", text: `Error: ${err}` }], isError: true };
      }
    }
  );

  // ── Tool: search_memory ──
  server.tool(
    "search_memory",
    "Semantic vector search across all memories. Returns results ranked by relevance (cosine similarity).",
    {
      query: z.string().describe("Natural language search query"),
      limit: z.number().optional().default(10).describe("Max results to return (default 10)"),
      project: z.string().optional().describe("Filter by project"),
      min_relevance: z.number().optional().default(0.3).describe("Minimum relevance score 0-1 (default 0.3)"),
    },
    async (args) => {
      const start = Date.now();
      try {
        const results = await search.search(
          args.query,
          args.limit,
          args.project,
          args.min_relevance,
          args.project ? undefined : defaultProject
        );

        const text = results.length === 0
          ? "No relevant memories found."
          : results
              .map(
                (r, i) =>
                  `[${i + 1}] (relevance: ${r.relevance}) [${r.memory.type}] ${r.memory.summary ?? r.memory.content.slice(0, 200)}\n    ID: ${r.memory.id} | Created: ${r.memory.created_at}${r.memory.tags.length ? ` | Tags: ${r.memory.tags.join(", ")}` : ""}`
              )
              .join("\n\n");

        auditLogger.log({
          action_type: "search_memory",
          tool_name: "search_memory",
          input: args,
          output: { count: results.length },
          duration_ms: Date.now() - start,
        });

        return { content: [{ type: "text", text }] };
      } catch (err) {
        auditLogger.log({
          action_type: "search_memory_error",
          tool_name: "search_memory",
          input: args,
          output: { error: String(err) },
          duration_ms: Date.now() - start,
        });
        return { content: [{ type: "text", text: `Error: ${err}` }], isError: true };
      }
    }
  );

  // ── Tool: search_by_type ──
  server.tool(
    "search_by_type",
    "Filter memories by type (conversation, decision, file_change, tool_usage) with optional text query.",
    {
      type: z.enum(["conversation", "decision", "file_change", "tool_usage"]),
      query: z.string().optional().describe("Optional text query to filter results"),
      limit: z.number().optional().default(20).describe("Max results (default 20)"),
      project: z.string().optional().describe("Filter by project"),
    },
    async (args) => {
      const start = Date.now();
      const results = search.searchByType(args.type, args.query, args.limit, args.project);

      const memories = Array.isArray(results)
        ? results.map((r) => ("memory" in r ? r.memory : r))
        : [results];

      const text = memories.length === 0
        ? `No ${args.type} memories found.`
        : memories
            .map(
              (m, i) =>
                `[${i + 1}] ${m.summary ?? m.content.slice(0, 200)}\n    ID: ${m.id} | Created: ${m.created_at}${m.tags.length ? ` | Tags: ${m.tags.join(", ")}` : ""}`
            )
            .join("\n\n");

      auditLogger.log({
        action_type: "search_by_type",
        tool_name: "search_by_type",
        input: args,
        output: { count: memories.length },
        duration_ms: Date.now() - start,
      });

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Tool: get_audit_log ──
  server.tool(
    "get_audit_log",
    "Query the audit trail of all tool invocations with date ranges, action type filters, and pagination.",
    {
      action_type: z.string().optional().describe("Filter by action type"),
      tool_name: z.string().optional().describe("Filter by tool name"),
      session_id: z.string().optional().describe("Filter by session ID"),
      since: z.string().optional().describe("Start date (ISO 8601)"),
      until: z.string().optional().describe("End date (ISO 8601)"),
      limit: z.number().optional().default(50).describe("Max results (default 50)"),
      offset: z.number().optional().default(0).describe("Pagination offset (default 0)"),
    },
    async (args) => {
      const { entries, total } = auditQuery.query(args as GetAuditLogInput);

      const text = entries.length === 0
        ? "No audit log entries found."
        : `Showing ${entries.length} of ${total} entries (offset ${args.offset}):\n\n` +
          entries
            .map(
              (e) =>
                `[${e.timestamp}] ${e.action_type}${e.tool_name ? ` (${e.tool_name})` : ""}${e.duration_ms != null ? ` ${e.duration_ms}ms` : ""}${e.session_id ? ` session:${e.session_id}` : ""}`
            )
            .join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Tool: get_session_summary ──
  server.tool(
    "get_session_summary",
    "Get summary and all memories for a specific session.",
    {
      session_id: z.string().describe("Session ID to look up"),
    },
    async (args) => {
      const session = db.db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(args.session_id) as Session | undefined;

      const memories = search.getSessionMemories(args.session_id);

      let text: string;
      if (!session && memories.length === 0) {
        text = `Session ${args.session_id} not found.`;
      } else {
        const header = session
          ? `Session: ${session.id}\nProject: ${session.project ?? "N/A"}\nStarted: ${session.started_at}\nEnded: ${session.ended_at ?? "ongoing"}\nSummary: ${session.summary ?? "N/A"}\n`
          : `Session: ${args.session_id} (no session record)\n`;

        const memoryList = memories.length === 0
          ? "No memories recorded."
          : memories
              .map(
                (m, i) =>
                  `  ${i + 1}. [${m.type}] ${m.summary ?? m.content.slice(0, 150)}`
              )
              .join("\n");

        text = `${header}\nMemories (${memories.length}):\n${memoryList}`;
      }

      auditLogger.log({
        action_type: "get_session_summary",
        tool_name: "get_session_summary",
        input: args,
        output: { found: !!(session || memories.length) },
      });

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Tool: list_recent_memories ──
  server.tool(
    "list_recent_memories",
    "List recent memories in reverse chronological order, optionally filtered by type and project.",
    {
      limit: z.number().optional().default(20).describe("Max results (default 20)"),
      type: z.enum(["conversation", "decision", "file_change", "tool_usage"]).optional().describe("Filter by memory type"),
      project: z.string().optional().describe("Filter by project"),
    },
    async (args) => {
      const memories = search.listRecent(args.limit, args.type, args.project);

      const text = memories.length === 0
        ? "No memories found."
        : memories
            .map(
              (m, i) =>
                `[${i + 1}] [${m.type}] ${m.summary ?? m.content.slice(0, 200)}\n    ID: ${m.id} | Created: ${m.created_at}${m.tags.length ? ` | Tags: ${m.tags.join(", ")}` : ""}`
            )
            .join("\n\n");

      auditLogger.log({
        action_type: "list_recent_memories",
        tool_name: "list_recent_memories",
        input: args,
        output: { count: memories.length },
      });

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Tool: forget_memory ──
  server.tool(
    "forget_memory",
    "Archive (soft delete) or permanently delete a memory by ID.",
    {
      id: z.string().describe("Memory ID to forget"),
      permanent: z.boolean().optional().default(false).describe("Permanently delete instead of archiving (default false)"),
    },
    async (args) => {
      const start = Date.now();
      let success: boolean;

      if (args.permanent) {
        success = store.permanentDelete(args.id);
      } else {
        success = store.archive(args.id);
      }

      const action = args.permanent ? "permanently deleted" : "archived";
      const text = success
        ? `Memory ${args.id} ${action}.`
        : `Memory ${args.id} not found or already ${action}.`;

      auditLogger.log({
        action_type: args.permanent ? "permanent_delete" : "archive_memory",
        tool_name: "forget_memory",
        input: args,
        output: { success },
        duration_ms: Date.now() - start,
      });

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Resource: recent memories ──
  server.resource(
    "recent-memories",
    "dali://memories/recent",
    { description: "10 most recent memories" },
    async () => {
      const memories = search.listRecent(10);
      return {
        contents: [
          {
            uri: "dali://memories/recent",
            mimeType: "application/json",
            text: JSON.stringify(memories, null, 2),
          },
        ],
      };
    }
  );

  // ── Resource: session memories ──
  server.resource(
    "session-memories",
    new ResourceTemplate("dali://sessions/{sessionId}/memories", { list: undefined }),
    { description: "Memories for a specific session" },
    async (uri, variables) => {
      const sessionId = variables.sessionId as string;
      const memories = search.getSessionMemories(sessionId);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(memories, null, 2),
          },
        ],
      };
    }
  );

  // Deferred: backfill embeddings after connect
  setTimeout(async () => {
    try {
      const available = await embedder.isAvailable();
      if (available) {
        const count = await store.backfillEmbeddings();
        if (count > 0) {
          console.error(`[dali] Backfilled ${count} embeddings`);
        }
      }
    } catch {
      // Silently ignore — backfill will happen next startup
    }
  }, 2000);

  return server;
}

function ensureSession(
  db: DaliDatabase,
  sessionId: string,
  project?: string
): void {
  const existing = db.db
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!existing) {
    db.db
      .prepare("INSERT INTO sessions (id, project) VALUES (?, ?)")
      .run(sessionId, project ?? null);
  }
}
