import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { buildRelevantContext } from "./src/context-hook.js";
import { DaliReadonlyDB, DaliWritableDB } from "./src/db.js";
import { OllamaEmbedder } from "./src/embedder.js";
import { createSearchTool } from "./src/search-tool.js";
import { createStoreTool } from "./src/store-tool.js";

interface DaliMemoryConfig {
  dbPath: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
  maxContextTokens: number;
  minRelevance: number;
  managedFiles: string[];
}

const DEFAULTS: DaliMemoryConfig = {
  dbPath: "~/.claude/dali/dali.db",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  embeddingModel: "nomic-embed-text",
  maxContextTokens: 800,
  minRelevance: 0.4,
  managedFiles: ["MEMORY.md", "TOOLS.md"],
};

function resolveConfig(raw: Record<string, unknown> | undefined): DaliMemoryConfig {
  return {
    dbPath: (raw?.dbPath as string) ?? DEFAULTS.dbPath,
    ollamaBaseUrl: (raw?.ollamaBaseUrl as string) ?? DEFAULTS.ollamaBaseUrl,
    embeddingModel: (raw?.embeddingModel as string) ?? DEFAULTS.embeddingModel,
    maxContextTokens: (raw?.maxContextTokens as number) ?? DEFAULTS.maxContextTokens,
    minRelevance: (raw?.minRelevance as number) ?? DEFAULTS.minRelevance,
    managedFiles: (raw?.managedFiles as string[]) ?? DEFAULTS.managedFiles,
  };
}

export default definePluginEntry({
  id: "dali-memory",
  name: "Dali Memory",
  description:
    "Semantic memory retrieval from local Dali SQLite vector database. Replaces static workspace file dumps with query-relevant context injection.",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    const resolvedDbPath = api.resolvePath(cfg.dbPath);

    const embedder = new OllamaEmbedder(cfg.ollamaBaseUrl, cfg.embeddingModel);
    const readDb = new DaliReadonlyDB(resolvedDbPath);
    const writeDb = new DaliWritableDB(resolvedDbPath);

    const readOk = readDb.open();
    if (readOk) {
      api.logger.info(`dali-memory: read-only DB opened (${resolvedDbPath})`);
    } else {
      api.logger.warn(`dali-memory: DB not found at ${resolvedDbPath} — search disabled`);
    }

    const writeOk = writeDb.open();
    if (!writeOk) {
      api.logger.warn(`dali-memory: writable DB failed to open — store disabled`);
    }

    // Register dali_search tool
    api.registerTool(createSearchTool({ db: readDb, embedder, minRelevance: cfg.minRelevance }), {
      name: "dali_search",
    });

    // Register dali_store tool
    api.registerTool(createStoreTool({ writeDb, embedder }), {
      name: "dali_store",
    });

    // before_prompt_build: inject relevant Dali memories as system context
    api.on("before_prompt_build", async (event) => {
      if (!readDb.isOpen || !event.prompt) {
        return {};
      }

      try {
        const context = await buildRelevantContext(event.prompt, readDb, embedder, {
          maxContextTokens: cfg.maxContextTokens,
          minRelevance: cfg.minRelevance,
          project: "openclaw",
        });

        if (context) {
          api.logger.info?.("dali-memory: injecting relevant context into system prompt");
          return { appendSystemContext: context };
        }
      } catch (err) {
        api.logger.warn(`dali-memory: context hook failed: ${String(err)}`);
      }

      return {};
    });

    // Service lifecycle
    api.registerService({
      id: "dali-memory",
      start: () => {
        api.logger.info(
          `dali-memory: started (db: ${resolvedDbPath}, model: ${cfg.embeddingModel})`,
        );
      },
      stop: () => {
        readDb.close();
        writeDb.close();
        api.logger.info("dali-memory: stopped");
      },
    });
  },
});
