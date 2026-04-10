# Verify Dali Integration

Paste this prompt into Claude Code to verify everything is working end-to-end:

---

Verify the Dali memory integration is working correctly. Run through each check:

## 1. Ollama Health Check
```bash
curl -s http://127.0.0.1:11434/api/tags | head -20
```
Should list available models including `nomic-embed-text`.

## 2. Database Exists
```bash
ls -la ~/.claude/dali/dali.db
```
Should show the database file (typically 1-5 MB).

## 3. Store a Test Memory
Use the `store_memory` tool:
- type: "conversation"
- content: "Integration verification test — Dali is working correctly with semantic vector search"
- tags: ["test", "verification"]
- summary: "Dali integration test memory"

## 4. Search for the Test Memory
Use the `search_memory` tool:
- query: "integration verification"
- min_relevance: 0.3

Should return the memory you just stored with high relevance (>70%).

## 5. Check Audit Log
Use the `get_audit_log` tool:
- limit: 5

Should show the store and search operations you just performed.

## 6. Run Benchmark (optional)
```bash
cd <path-to-dali-memory-openclaw>
npm run benchmark
```
Should output token savings and latency measurements.

## 7. Verify Graceful Degradation
```bash
# Temporarily stop Ollama
pkill ollama
```
Then try `search_memory` — it should return gracefully with no crash.

```bash
# Restart Ollama
ollama serve &
```

## Expected Results
- All 7 Dali tools visible in Claude Code
- Store + search round-trip works
- Audit log captures operations
- Graceful no-op when Ollama is down
