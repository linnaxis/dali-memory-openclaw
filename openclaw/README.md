# Dali Memory — OpenClaw Plugin

This directory contains the OpenClaw plugin adapter for Dali. It bridges the standalone Dali MCP server into OpenClaw's plugin system, providing:

- **`dali_search` tool** — semantic search across stored memories
- **`dali_store` tool** — store new memories with auto-embedding
- **`before_prompt_build` hook** — injects relevant context into every prompt automatically

## Install

### Prerequisites

- Dali MCP server installed and working (see [parent README](../README.md))
- Ollama running with `nomic-embed-text` model
- [OpenClaw](https://github.com/openclaw/openclaw)

### Quick Install

```bash
# From npm
openclaw plugins install @openclaw/dali-memory

# From GitHub (no npm publish required)
openclaw plugins install github:linnaxis/dali-memory-openclaw

# From a local clone
openclaw plugins install ./openclaw
```

### Plugin Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "dali-memory": {
      "enabled": true,
      "dbPath": "~/.claude/dali/dali.db",
      "ollamaBaseUrl": "http://127.0.0.1:11434",
      "embeddingModel": "nomic-embed-text",
      "maxContextTokens": 400,
      "minRelevance": 0.35,
      "managedFiles": ["MEMORY.md", "TOOLS.md"]
    }
  }
}
```

### Index Workspace Files (optional)

Seed Dali from existing `.md` workspace files:

```bash
npx tsx extensions/dali-memory/scripts/index-workspace.ts
```

### Manual Install (for monorepo development)

If you're working inside the OpenClaw monorepo instead of using `openclaw plugins install`:

1. Copy into extensions:
   ```bash
   cp -r openclaw/ <your-openclaw-repo>/extensions/dali-memory/
   ```

2. Create SDK subpath at `src/plugin-sdk/dali-memory.ts`:
   ```typescript
   export * from "../../extensions/dali-memory/api.js";
   ```

3. Install dependencies: `pnpm install`

4. Verify build: `pnpm tsgo`

## Architecture

```
User message
    |
    v
[context-hook.ts]  <-- before_prompt_build
    |  embed query via Ollama
    |  KNN search in SQLite
    |  format top results
    v
[system prompt + <dali-context>]
    |
    v
[LLM generates response]
    |
    v
[store-tool.ts]  <-- agent can call dali_store
[search-tool.ts] <-- agent can call dali_search
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry point — registers tools + hooks |
| `api.ts` | Public API barrel export |
| `openclaw.plugin.json` | Plugin manifest + config schema |
| `src/db.ts` | Read-only + writable SQLite clients |
| `src/embedder.ts` | Ollama embedding client (3s timeout) |
| `src/search-tool.ts` | `dali_search` tool implementation |
| `src/store-tool.ts` | `dali_store` tool implementation |
| `src/context-hook.ts` | Automatic context injection hook |
| `scripts/index-workspace.ts` | One-time workspace file indexer |

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dbPath` | string | `~/.claude/dali/dali.db` | Path to SQLite database |
| `ollamaBaseUrl` | string | `http://127.0.0.1:11434` | Ollama API endpoint |
| `embeddingModel` | string | `nomic-embed-text` | Embedding model name |
| `maxContextTokens` | number | `400` | Max tokens to inject per turn |
| `minRelevance` | number | `0.35` | Minimum cosine similarity threshold |
| `managedFiles` | string[] | `["MEMORY.md", "TOOLS.md"]` | Files replaced with Dali stubs |
