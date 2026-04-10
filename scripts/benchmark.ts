#!/usr/bin/env npx tsx
/**
 * Dali Memory Benchmark
 *
 * Measures token savings and latency for Dali vs static workspace files.
 *
 * Usage:
 *   npm run benchmark
 *   npx tsx scripts/benchmark.ts [workspace-dir]
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const DEFAULT_WORKSPACE = path.join(HOME, "openclaw-data", ".openclaw", "workspace");
const DEFAULT_DB_PATH = path.join(HOME, ".claude", "dali", "dali.db");
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "nomic-embed-text";

const CHARS_PER_TOKEN = 4;

// ── Helpers ──

function countTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function formatRow(cols: string[], widths: number[]): string {
  return "| " + cols.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
}

function formatTable(headers: string[], rows: string[][], widths: number[]): string {
  const lines: string[] = [];
  lines.push(formatRow(headers, widths));
  lines.push("| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |");
  for (const row of rows) {
    lines.push(formatRow(row, widths));
  }
  return lines.join("\n");
}

// ── Workspace File Analysis ──

function analyzeWorkspaceFiles(workspaceDir: string): { name: string; chars: number; tokens: number; managedByDali: boolean }[] {
  const MANAGED = new Set(["MEMORY.md", "TOOLS.md"]);
  const results: { name: string; chars: number; tokens: number; managedByDali: boolean }[] = [];

  if (!fs.existsSync(workspaceDir)) {
    console.log(`Workspace directory not found: ${workspaceDir}`);
    console.log("Using estimated values from reference deployment.\n");

    // Reference values from the OpenClaw instance
    return [
      { name: "MEMORY.md", chars: 3267, tokens: 817, managedByDali: true },
      { name: "TOOLS.md", chars: 1880, tokens: 470, managedByDali: true },
      { name: "AGENTS.md", chars: 2738, tokens: 685, managedByDali: false },
      { name: "SOUL.md", chars: 1598, tokens: 400, managedByDali: false },
      { name: "BOOTSTRAP.md", chars: 1906, tokens: 477, managedByDali: false },
      { name: "SHORTHAND.md", chars: 1139, tokens: 285, managedByDali: false },
      { name: "USER.md", chars: 424, tokens: 106, managedByDali: false },
      { name: "IDENTITY.md", chars: 316, tokens: 79, managedByDali: false },
      { name: "HEARTBEAT.md", chars: 218, tokens: 55, managedByDali: false },
    ];
  }

  const files = fs.readdirSync(workspaceDir).filter((f) => f.endsWith(".md")).sort();

  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const content = fs.readFileSync(filePath, "utf-8");

    // Check if this is a Dali stub (very short content)
    const isStub = content.length < 100 && content.includes("Managed by Dali");

    // If it's a stub, try to find the backup
    let chars: number;
    if (isStub) {
      const backupPath = path.join(workspaceDir, `${file}.pre-dali.bak`);
      if (fs.existsSync(backupPath)) {
        chars = fs.readFileSync(backupPath, "utf-8").length;
      } else {
        chars = content.length;
      }
    } else {
      chars = content.length;
    }

    results.push({
      name: file,
      chars,
      tokens: countTokens(chars.toString().length > 0 ? "x".repeat(chars) : ""),
      managedByDali: MANAGED.has(file),
    });
  }

  // Recalculate tokens properly
  return results.map((r) => ({
    ...r,
    tokens: Math.ceil(r.chars / CHARS_PER_TOKEN),
  }));
}

// ── Ollama Latency Test ──

async function measureOllamaLatency(url: string, model: string, queries: string[]): Promise<number[]> {
  const latencies: number[] = [];

  for (const query of queries) {
    const start = performance.now();
    try {
      const res = await fetch(`${url}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: query }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.log(`  Ollama error: ${res.status}`);
        continue;
      }

      await res.json();
      latencies.push(performance.now() - start);
    } catch (err) {
      console.log(`  Ollama unavailable: ${err}`);
      break;
    }
  }

  return latencies;
}

// ── SQLite KNN Search Latency ──

async function measureSearchLatency(dbPath: string): Promise<number | null> {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const { default: Database } = await import("better-sqlite3");
    const sqliteVec = await import("sqlite-vec");

    const db = new Database(dbPath, { readonly: true });
    sqliteVec.load(db);

    // Check if there are any embeddings
    const count = db.prepare("SELECT COUNT(*) as n FROM memory_vec_map").get() as { n: number };
    if (count.n === 0) {
      db.close();
      return null;
    }

    // Generate a random 768-dim vector for testing
    const dim = 768;
    const vec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      vec[i] = Math.random() * 2 - 1;
    }

    const start = performance.now();
    db.prepare(
      `SELECT rowid, distance FROM memory_embeddings WHERE embedding MATCH ? AND k = 10`
    ).all(Buffer.from(vec.buffer));
    const elapsed = performance.now() - start;

    db.close();
    return elapsed;
  } catch (err) {
    console.log(`  DB search error: ${err}`);
    return null;
  }
}

// ── Main ──

async function main() {
  const workspaceDir = process.argv[2] ?? DEFAULT_WORKSPACE;
  const dbPath = process.env.DALI_DB_PATH ?? DEFAULT_DB_PATH;

  console.log("=".repeat(60));
  console.log("  Dali Memory Benchmark");
  console.log("=".repeat(60));
  console.log();

  // ── 1. Workspace File Analysis ──
  console.log("## Workspace Context Breakdown\n");

  const files = analyzeWorkspaceFiles(workspaceDir);
  const totalChars = files.reduce((s, f) => s + f.chars, 0);
  const totalTokens = files.reduce((s, f) => s + f.tokens, 0);
  const managedChars = files.filter((f) => f.managedByDali).reduce((s, f) => s + f.chars, 0);
  const managedTokens = files.filter((f) => f.managedByDali).reduce((s, f) => s + f.tokens, 0);

  const fileHeaders = ["File", "Chars", "Tokens", "Managed by Dali?"];
  const fileWidths = [20, 8, 8, 18];
  const fileRows = files.map((f) => [
    f.name,
    f.chars.toLocaleString(),
    f.tokens.toLocaleString(),
    f.managedByDali ? "Yes -> stub" : "No (always loaded)",
  ]);
  fileRows.push(["---", "---", "---", "---"]);
  fileRows.push(["Total", totalChars.toLocaleString(), totalTokens.toLocaleString(), ""]);
  fileRows.push(["Dali-managed", managedChars.toLocaleString(), managedTokens.toLocaleString(), ""]);

  console.log(formatTable(fileHeaders, fileRows, fileWidths));
  console.log();

  // ── 2. Token Savings Per Turn ──
  console.log("## Token Savings Per Turn\n");

  const stubTokens = 10; // ~10 tokens for "Managed by Dali" stub
  const avgDaliContext = 250; // Average injected context tokens
  const staticTotal = totalTokens;
  const dynamicTotal = totalTokens - managedTokens + (files.filter((f) => f.managedByDali).length * stubTokens) + avgDaliContext;
  const savings = staticTotal - dynamicTotal;

  const savingsHeaders = ["Metric", "Static (Before)", "Dynamic (After)", "Savings"];
  const savingsWidths = [25, 18, 18, 12];
  const savingsRows = [
    ["Dali-managed files", `${managedTokens} tokens`, `~${files.filter((f) => f.managedByDali).length * stubTokens} token stubs`, `-${managedTokens - files.filter((f) => f.managedByDali).length * stubTokens}`],
    ["Dali context injection", "0", `~${avgDaliContext} avg`, `+${avgDaliContext}`],
    ["Net per turn", `${staticTotal} tokens`, `~${dynamicTotal} tokens`, `~${savings} tokens`],
  ];

  console.log(formatTable(savingsHeaders, savingsRows, savingsWidths));
  console.log();

  // ── 3. Cost Projections ──
  console.log("## Cost Projections (Claude Sonnet 4, $3/M input tokens)\n");

  const costPer1M = 3.0;
  const turnsPerDay = 100;

  const staticMonthly = (staticTotal * turnsPerDay * 30 / 1_000_000) * costPer1M;
  const dynamicMonthly = (dynamicTotal * turnsPerDay * 30 / 1_000_000) * costPer1M;

  const costHeaders = ["Scenario", "Tokens/turn", "100 turns/day", "Monthly cost"];
  const costWidths = [20, 14, 14, 14];
  const costRows = [
    ["Static (all .md)", staticTotal.toLocaleString(), (staticTotal * turnsPerDay).toLocaleString(), `$${staticMonthly.toFixed(2)}`],
    ["With Dali (avg)", dynamicTotal.toLocaleString(), (dynamicTotal * turnsPerDay).toLocaleString(), `$${dynamicMonthly.toFixed(2)}`],
    ["Savings", `~${savings}`, (savings * turnsPerDay).toLocaleString(), `$${(staticMonthly - dynamicMonthly).toFixed(2)}`],
  ];

  console.log(formatTable(costHeaders, costRows, costWidths));
  console.log();

  // ── 4. Ollama Embed Latency ──
  console.log("## Ollama Embedding Latency\n");

  const testQueries = [
    "How do I configure the database?",
    "What tools are available?",
    "Previous conversation about authentication",
    "File changes in the last session",
    "Architecture decisions for the project",
  ];

  console.log(`Testing ${testQueries.length} queries against ${DEFAULT_OLLAMA_URL} (${DEFAULT_MODEL})...\n`);

  const latencies = await measureOllamaLatency(DEFAULT_OLLAMA_URL, DEFAULT_MODEL, testQueries);

  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const avg = latencies.reduce((s, l) => s + l, 0) / latencies.length;

    const latHeaders = ["Metric", "Value"];
    const latWidths = [20, 15];
    const latRows = [
      ["Queries", `${latencies.length}/${testQueries.length}`],
      ["Min", `${min.toFixed(1)} ms`],
      ["Median", `${median.toFixed(1)} ms`],
      ["Mean", `${avg.toFixed(1)} ms`],
      ["Max", `${max.toFixed(1)} ms`],
    ];

    console.log(formatTable(latHeaders, latRows, latWidths));
  } else {
    console.log("Ollama not available — skipping embedding latency test.");
    console.log("Expected: 15-50ms per embed (local CPU/GPU).");
  }
  console.log();

  // ── 5. KNN Search Latency ──
  console.log("## SQLite KNN Search Latency\n");

  const searchLatency = await measureSearchLatency(dbPath);

  if (searchLatency !== null) {
    console.log(`DB: ${dbPath}`);
    console.log(`KNN search (768-dim, top 10): ${searchLatency.toFixed(1)} ms`);
  } else {
    console.log("No database found or no embeddings stored — skipping KNN test.");
    console.log("Expected: <5ms for 165 memories (in-memory after first query).");
  }
  console.log();

  // ── 6. Database Size ──
  console.log("## Database Size\n");

  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    // Count memories
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const count = db.prepare("SELECT COUNT(*) as n FROM memories WHERE archived = 0").get() as { n: number };
      db.close();
      console.log(`Memories: ${count.n}`);
      console.log(`DB size:  ${sizeMB} MB`);
    } catch {
      console.log(`DB size: ${sizeMB} MB`);
    }
  } else {
    console.log("No database found.");
  }

  console.log();
  console.log("=".repeat(60));
  console.log("  Benchmark complete");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
