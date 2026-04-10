import { z } from "zod";

// ── Memory Types ──

export const MemoryType = z.enum([
  "conversation",
  "decision",
  "file_change",
  "tool_usage",
]);
export type MemoryType = z.infer<typeof MemoryType>;

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

export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  session_id: string | null;
  project: string | null;
  tags: string;
  metadata: string;
  created_at: string;
  archived: number;
}

// ── Audit Log Types ──

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action_type: string;
  tool_name: string | null;
  input: string | null;
  output: string | null;
  session_id: string | null;
  duration_ms: number | null;
}

// ── Session Types ──

export interface Session {
  id: string;
  project: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

// ── File Change Types ──

export interface FileChange {
  id: number;
  memory_id: string;
  file_path: string;
  change_type: string;
  diff_summary: string | null;
  lines_added: number;
  lines_removed: number;
}

// ── Tool Input Schemas ──

export const StoreMemoryInput = z.object({
  type: MemoryType,
  content: z.string().describe("The memory content to store"),
  summary: z.string().optional().describe("Short summary of the memory"),
  session_id: z.string().optional().describe("Session ID to associate with"),
  project: z.string().optional().describe("Project name"),
  tags: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Tags for categorization"),
  metadata: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe("Arbitrary metadata"),
  // file_change specific fields
  file_path: z.string().optional().describe("File path (for file_change type)"),
  change_type: z
    .string()
    .optional()
    .describe("Change type: create/modify/delete (for file_change type)"),
  diff_summary: z
    .string()
    .optional()
    .describe("Summary of diff (for file_change type)"),
  lines_added: z
    .number()
    .optional()
    .default(0)
    .describe("Lines added (for file_change type)"),
  lines_removed: z
    .number()
    .optional()
    .default(0)
    .describe("Lines removed (for file_change type)"),
});
export type StoreMemoryInput = z.infer<typeof StoreMemoryInput>;

export const SearchMemoryInput = z.object({
  query: z.string().describe("Natural language search query"),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe("Max results to return (default 10)"),
  project: z.string().optional().describe("Filter by project"),
  min_relevance: z
    .number()
    .optional()
    .default(0.3)
    .describe("Minimum relevance score 0-1 (default 0.3)"),
});
export type SearchMemoryInput = z.infer<typeof SearchMemoryInput>;

export const SearchByTypeInput = z.object({
  type: MemoryType,
  query: z.string().optional().describe("Optional text query to filter results"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Max results (default 20)"),
  project: z.string().optional().describe("Filter by project"),
});
export type SearchByTypeInput = z.infer<typeof SearchByTypeInput>;

export const GetAuditLogInput = z.object({
  action_type: z.string().optional().describe("Filter by action type"),
  tool_name: z.string().optional().describe("Filter by tool name"),
  session_id: z.string().optional().describe("Filter by session ID"),
  since: z.string().optional().describe("Start date (ISO 8601)"),
  until: z.string().optional().describe("End date (ISO 8601)"),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe("Max results (default 50)"),
  offset: z
    .number()
    .optional()
    .default(0)
    .describe("Pagination offset (default 0)"),
});
export type GetAuditLogInput = z.infer<typeof GetAuditLogInput>;

export const GetSessionSummaryInput = z.object({
  session_id: z.string().describe("Session ID to look up"),
});
export type GetSessionSummaryInput = z.infer<typeof GetSessionSummaryInput>;

export const ListRecentMemoriesInput = z.object({
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Max results (default 20)"),
  type: MemoryType.optional().describe("Filter by memory type"),
  project: z.string().optional().describe("Filter by project"),
});
export type ListRecentMemoriesInput = z.infer<typeof ListRecentMemoriesInput>;

export const ForgetMemoryInput = z.object({
  id: z.string().describe("Memory ID to forget"),
  permanent: z
    .boolean()
    .optional()
    .default(false)
    .describe("Permanently delete instead of archiving (default false)"),
});
export type ForgetMemoryInput = z.infer<typeof ForgetMemoryInput>;

// ── Search Result ──

export interface SearchResult {
  memory: Memory;
  relevance: number;
}
