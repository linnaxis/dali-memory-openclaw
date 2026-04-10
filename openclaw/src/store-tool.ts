import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../api.js";
import type { DaliWritableDB, MemoryType } from "./db.js";
import type { OllamaEmbedder } from "./embedder.js";

const MEMORY_TYPES = ["conversation", "decision", "file_change", "tool_usage"] as const;

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    description,
  });
}

const DaliStoreSchema = Type.Object(
  {
    content: Type.String({ description: "The memory content to store." }),
    summary: Type.Optional(
      Type.String({ description: "Short summary of the memory." }),
    ),
    type: Type.Optional(
      stringEnum(MEMORY_TYPES, "Memory type (default: conversation)."),
    ),
    project: Type.Optional(
      Type.String({ description: "Project to associate with this memory." }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), { description: "Tags for categorization." }),
    ),
  },
  { additionalProperties: false },
);

export function createStoreTool(params: {
  writeDb: DaliWritableDB;
  embedder: OllamaEmbedder;
}): AnyAgentTool {
  return {
    name: "dali_store",
    label: "Dali Store",
    description:
      "Store a new memory in the Dali vector database with automatic embedding. Use for saving user preferences, decisions, project context, or tool usage notes that should persist across sessions.",
    parameters: DaliStoreSchema,
    async execute(_toolCallId, rawParams) {
      const {
        content,
        summary,
        type = "conversation",
        project,
        tags,
      } = rawParams as {
        content: string;
        summary?: string;
        type?: MemoryType;
        project?: string;
        tags?: string[];
      };

      if (!params.writeDb.isOpen) {
        return {
          content: [{ type: "text", text: "Dali database is not available for writing." }],
          details: { error: "db_unavailable" },
        };
      }

      const id = params.writeDb.store({
        type,
        content,
        summary,
        project,
        tags,
      });

      if (!id) {
        return {
          content: [{ type: "text", text: "Failed to store memory." }],
          details: { error: "store_failed" },
        };
      }

      // Generate and store embedding
      try {
        const textToEmbed = summary ? `${summary}\n\n${content}` : content;
        const embedding = await params.embedder.embed(textToEmbed);
        params.writeDb.insertEmbedding(id, embedding);
      } catch {
        // Ollama unavailable — embedding will be backfilled later
      }

      return {
        content: [
          { type: "text", text: `Memory stored: "${(summary ?? content).slice(0, 100)}"` },
        ],
        details: { action: "created", id },
      };
    },
  };
}
