# Install Dali MCP Server

Paste this prompt into Claude Code to have it set up Dali for you:

---

I want you to set up Dali, a local vector memory MCP server that gives you persistent semantic memory across sessions.

## Prerequisites

1. **Ollama** must be installed and running with the `nomic-embed-text` model:
   ```bash
   # Install Ollama (macOS)
   brew install ollama

   # Pull the embedding model
   ollama pull nomic-embed-text

   # Verify it works
   ollama run nomic-embed-text "test"
   ```

## Steps

1. Clone/locate the `dali-memory-openclaw` repository
2. Install dependencies and build:
   ```bash
   cd <path-to-dali-memory-openclaw>
   npm install
   npm run build
   ```
3. Add the MCP server config to your Claude Code settings. Copy `.mcp.json.example` to `~/.mcp.json` (or merge into existing), replacing `<path-to-dali-memory-openclaw>` with the actual absolute path:
   ```json
   {
     "mcpServers": {
       "dali": {
         "type": "stdio",
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
4. Restart Claude Code
5. Verify the Dali tools appear: you should see `store_memory`, `search_memory`, `search_by_type`, `get_audit_log`, `get_session_summary`, `list_recent_memories`, and `forget_memory`
6. Test by storing a memory:
   ```
   Use the store_memory tool to store a test memory with type "conversation" and content "Dali installation test"
   ```
7. Search for it:
   ```
   Use the search_memory tool to search for "installation test"
   ```

If both work, Dali is ready. The database will be created automatically at `~/.claude/dali/dali.db`.
