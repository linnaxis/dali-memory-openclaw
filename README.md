# 🦞 Dali Memory

<p align="center">
  <img src="image.png" alt="Dali" width="400">
</p>

Local vector memory system for AI coding assistants. Gives Claude Code (or any MCP client) persistent semantic memory across sessions using SQLite + [sqlite-vec](https://github.com/asg017/sqlite-vec) + [Ollama](https://ollama.com) embeddings.

Includes an optional [OpenClaw](https://github.com/openclaw) plugin adapter for automatic context injection.

## Why

AI coding assistants forget everything between sessions. The typical workaround — dumping large `.md` files into every prompt — wastes tokens on irrelevant context.

Dali replaces static context dumps with **semantic retrieval**: only memories relevant to the current conversation are injected, saving ~1,000 tokens per turn.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Claude Code / MCP Client                           │
│                                                     │
│  store_memory ──┐    search_memory ──┐              │
│  search_by_type ┤    forget_memory   ┤              │
│  get_audit_log  ┤    list_recent     ┤              │
│  get_session    ┘                    ┘              │
└──────────────┬───────────────────────┬──────────────┘
               │ stdio (MCP)          │
               v                      v
┌──────────────────────────────────────────────────────┐
│  Dali MCP Server (src/)                              │
│                                                      │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐ │
│  │ memory/  │  │ embeddings/│  │ audit/           │ │
│  │ store.ts │  │ ollama.ts  │──│ logger.ts        │ │
│  │ search.ts│  │            │  │ query.ts         │ │
│  └────┬─────┘  └─────┬──────┘  └──────────────────┘ │
│       │              │                               │
│       v              v                               │
│  ┌─────────────────────────┐                         │
│  │  SQLite + sqlite-vec    │                         │
│  │  768-dim cosine KNN     │                         │
│  │  WAL mode               │                         │
│  └─────────────────────────┘                         │
└──────────────────────────────────────────────────────┘
               │
               v
┌──────────────────────────┐
│  Ollama (local)          │
│  nomic-embed-text        │
│  768-dim embeddings      │
└──────────────────────────┘
```

## Quickstart

### 1. Install Ollama

```bash
brew install ollama        # macOS
ollama pull nomic-embed-text
ollama serve               # start the server
```

### 2. Clone and Build

```bash
git clone https://github.com/linnaxis/dali-memory-openclaw.git
cd dali-memory-openclaw
npm install
npm run build
```

### 3. Configure MCP

Copy `.mcp.json.example` to `~/.claude/mcp.json` (or merge into your existing config):

```json
{
  "mcpServers": {
    "dali": {
      "command": "node",
      "args": ["/absolute/path/to/dali-memory-openclaw/dist/index.js"],
      "env": {
        "DALI_DB_PATH": "~/.claude/dali/dali.db",
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

### 4. Verify

Start Claude Code. You should see 7 new tools:
- `store_memory` — persist a memory with auto-embedding
- `search_memory` — semantic vector search
- `search_by_type` — filter by type + text query
- `get_audit_log` — query tool invocation history
- `get_session_summary` — all memories for a session
- `list_recent_memories` — chronological listing
- `forget_memory` — archive or delete

## Efficiency Benchmarks

Based on a real deployment with 165 memories (3.5 MB database):

### Token Savings Per Turn

| Metric | Static (Before) | Dynamic (After) | Savings |
|--------|-----------------|------------------|---------|
| Managed .md files | 1,287 tokens | ~20 token stubs | -1,267 |
| Dali context injection | 0 | ~100-400 avg | +100-400 |
| **Net per turn** | **1,287 tokens** | **~220-420 tokens** | **~870-1,070** |

### Cost Projections (Claude Sonnet 4, $3/M input tokens)

| Scenario | Tokens/turn | 100 turns/day | Monthly cost |
|----------|-------------|---------------|-------------|
| Static (all .md) | 3,373 | 337,300 | $30.36 |
| With Dali (avg) | 2,406 | 240,600 | $21.65 |
| **Savings** | **~967** | **96,700** | **$8.70** |

### Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Ollama embed (nomic-embed-text) | 15-50ms | Local inference |
| SQLite KNN search (768-dim) | <5ms | In-memory after first query |
| Full retrieval pipeline | 20-60ms | Dominated by Ollama |
| Ollama down (fallback) | 0ms | Graceful no-op |

### Database Size

| Memories | Size |
|----------|------|
| 165 | 3.5 MB |
| ~1,000 | ~15 MB |
| ~10,000 | ~120 MB |

Run `npm run benchmark` for live measurements against your instance.

## OpenClaw Integration

The `openclaw/` directory contains an optional plugin adapter that integrates Dali into [OpenClaw](https://github.com/openclaw). It provides:

- **Automatic context injection** — a `before_prompt_build` hook embeds the user's message, searches for relevant memories, and injects them into the system prompt
- **Agent tools** — `dali_search` and `dali_store` let the agent query and persist memories
- **Workspace indexer** — one-time script to seed Dali from existing `.md` workspace files

### Install the Plugin

```bash
# From npm
openclaw plugins install @openclaw/dali-memory

# From GitHub (no npm publish required)
openclaw plugins install github:linnaxis/dali-memory-openclaw

# From a local clone
openclaw plugins install ./openclaw
```

See [`openclaw/README.md`](openclaw/README.md) for configuration and detailed setup.

## Claude Code Integration Prompts

The `prompts/` directory contains ready-to-paste prompts for Claude Code:

| Prompt | Purpose |
|--------|---------|
| [`INSTALL_DALI.md`](prompts/INSTALL_DALI.md) | Install and configure the Dali MCP server |
| [`INSTALL_OPENCLAW_PLUGIN.md`](prompts/INSTALL_OPENCLAW_PLUGIN.md) | Wire the plugin into an OpenClaw instance |
| [`VERIFY_INTEGRATION.md`](prompts/VERIFY_INTEGRATION.md) | Test the full integration end-to-end |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DALI_DB_PATH` | `~/.claude/dali/dali.db` | SQLite database path |
| `DALI_PROJECT` | Current directory name | Default project name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `nomic-embed-text` | Embedding model |

## Database Schema

Dali uses SQLite with the sqlite-vec extension for vector search.

### Tables

| Table | Purpose |
|-------|---------|
| `memories` | Core storage — type, content, summary, tags, metadata, project |
| `memory_vec_map` | Bridge: maps UUID `memory_id` to integer `rowid` for vec0 |
| `memory_embeddings` | vec0 virtual table — 768-dim cosine distance vectors |
| `audit_log` | Tool invocation history with timing |
| `sessions` | Session tracking with project association |
| `file_changes` | File modification records linked to memories |
| `schema_version` | Migration version tracking |

### Design Decisions

- **Bridge table pattern**: sqlite-vec requires integer rowids; memories use UUIDs. The `memory_vec_map` table bridges them.
- **WAL mode**: Enables concurrent reads during writes.
- **Graceful degradation**: Memories are stored immediately; embeddings are backfilled asynchronously when Ollama becomes available.
- **JSON storage**: Tags and metadata stored as JSON strings, parsed on read.

## Project Structure

```
dali-memory-openclaw/
├── README.md
├── package.json
├── tsconfig.json
├── .mcp.json.example
├── LICENSE
├── src/                          # Dali MCP server
│   ├── index.ts                  # Entry point (stdio transport)
│   ├── server.ts                 # Tool + resource definitions
│   ├── types.ts                  # Interfaces + Zod schemas
│   ├── db/
│   │   ├── client.ts             # Database init, WAL, migrations
│   │   └── schema.ts             # DDL + version tracking
│   ├── memory/
│   │   ├── search.ts             # KNN vector search + text filtering
│   │   └── store.ts              # Insert, embed, archive, delete
│   ├── embeddings/
│   │   └── ollama.ts             # Ollama /api/embed client
│   └── audit/
│       ├── logger.ts             # Audit log insertion
│       └── query.ts              # Audit log query + filtering
├── openclaw/                     # OpenClaw plugin (optional)
│   ├── README.md
│   ├── package.json
│   ├── openclaw.plugin.json
│   ├── api.ts
│   ├── index.ts
│   ├── src/
│   │   ├── db.ts
│   │   ├── embedder.ts
│   │   ├── search-tool.ts
│   │   ├── store-tool.ts
│   │   └── context-hook.ts
│   └── scripts/
│       └── index-workspace.ts
├── scripts/
│   └── benchmark.ts              # Token savings + latency benchmark
└── prompts/
    ├── INSTALL_DALI.md
    ├── INSTALL_OPENCLAW_PLUGIN.md
    └── VERIFY_INTEGRATION.md
```

## License

MIT
