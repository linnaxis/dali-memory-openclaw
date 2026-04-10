# Install Dali OpenClaw Plugin

Paste this prompt into Claude Code to wire the Dali plugin into your OpenClaw instance:

---

I want you to integrate the Dali memory plugin into my OpenClaw instance. The plugin source is in the `openclaw/` directory of the `dali-memory-openclaw` repo.

## Steps

1. Copy the `openclaw/` directory contents into `extensions/dali-memory/` in your OpenClaw repo:
   ```bash
   cp -r <path-to-dali-memory-openclaw>/openclaw/ <your-openclaw-repo>/extensions/dali-memory/
   ```

2. Create the plugin SDK subpath at `src/plugin-sdk/dali-memory.ts` that re-exports the plugin's public API

3. Add a subpath export to the root `package.json`:
   ```json
   "exports": {
     "./plugin-sdk/dali-memory": "./src/plugin-sdk/dali-memory.ts"
   }
   ```

4. Install dependencies:
   ```bash
   cd <your-openclaw-repo>
   pnpm install
   ```

5. Run the workspace indexing script to seed Dali with your workspace files:
   ```bash
   npx tsx extensions/dali-memory/scripts/index-workspace.ts
   ```

6. Add the plugin config to your `openclaw.json` configuration:
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

7. Verify the build:
   ```bash
   pnpm tsgo
   ```
   Should show zero errors from dali-memory files.
