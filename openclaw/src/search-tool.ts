import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../api.js";
import type { DaliReadonlyDB, MemoryType } from "./db.js";
import type { OllamaEmbedder } from "./embedder.js";

const MEMORY_TYPES = ["conversation", "decision", "file_change", "tool_usage"] as const;

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    description,
  });
}

const DaliSearchSchema = Type.Object(
  {
    query: Type.String({ description: "Natural language search query." }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum results to return (default: 5).",
        minimum: 1,
        maximum: 20,
      }),
    ),
    type: Type.Optional(
      stringEnum(MEMORY_TYPES, "Filter by memory type."),
    ),
    project: Type.Optional(
      Type.String({ description: "Filter by project name." }),
    ),
  },
  { additionalProperties: false },
);

export function createSearchTool(params: {
  db: DaliReadonlyDB;
  embedder: OllamaEmbedder;
  minRelevance: number;
}): AnyAgentTool {
  return {
    name: "dali_search",
    label: "Dali Search",
    description:
      "Search long-term memories in the Dali vector database. Returns semantically relevant memories ranked by cosine similarity. Use for recalling user preferences, past decisions, project context, or tool usage notes.",
    parameters: DaliSearchSchema,
    async execute(_toolCallId, rawParams) {
      const { query, limit = 5, type, project } = rawParams as {
        query: string;
        limit?: number;
        type?: MemoryType;
        project?: string;
      };

      // If type filter is set, use text-based search
      if (type) {
        const memories = params.db.searchByType(type, query, limit, project);
        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: "No matching memories found." }],
            details: { count: 0 },
          };
        }

        const text = memories
          .map(
            (m, i) =>
              `${i + 1}. [${m.type}] ${m.summary ?? m.content.slice(0, 200)}`,
          )
          .join("\n");

        return {
          content: [{ type: "text", text: `Found ${memories.length} memories:\n\n${text}` }],
          details: { count: memories.length },
        };
      }

      // Vector search
      let embedding: number[];
      try {
        embedding = await params.embedder.embed(query);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Embedding failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: "embedding_failed" },
        };
      }

      const results = params.db.search(embedding, limit, params.minRelevance, project);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No relevant memories found." }],
          details: { count: 0 },
        };
      }

      const text = results
        .map(
          (r, i) =>
            `${i + 1}. [${r.memory.type}] ${r.memory.summary ?? r.memory.content.slice(0, 200)} (${(r.relevance * 100).toFixed(0)}%)`,
        )
        .join("\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
        details: {
          count: results.length,
          results: results.map((r) => ({
            id: r.memory.id,
            type: r.memory.type,
            summary: r.memory.summary,
            relevance: r.relevance,
          })),
        },
      };
    },
  };
}
