#!/usr/bin/env npx tsx
/**
 * Index workspace .md files into Dali's SQLite vector database.
 *
 * Usage:
 *   npx tsx extensions/dali-memory/scripts/index-workspace.ts [workspace-dir]
 *
 * Defaults:
 *   workspace-dir: ~/openclaw-data/.openclaw/workspace
 *   DB path: ~/.claude/dali/dali.db
 *   Ollama: http://127.0.0.1:11434 with nomic-embed-text
 */

import fs from "node:fs";
import path from "node:path";
import { DaliWritableDB } from "../src/db.js";
import { OllamaEmbedder } from "../src/embedder.js";

const HOME = process.env.HOME ?? "";
const DEFAULT_WORKSPACE = path.join(HOME, "openclaw-data", ".openclaw", "workspace");
const DEFAULT_DB_PATH = path.join(HOME, ".claude", "dali", "dali.db");
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "nomic-embed-text";

const MANAGED_FILES = ["MEMORY.md", "TOOLS.md"];

interface Chunk {
  filename: string;
  section: string;
  content: string;
}

function chunkBySection(filename: string, text: string): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  let currentSection = filename;
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Flush previous section
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content.length > 10) {
          chunks.push({ filename, section: currentSection, content });
        }
      }
      currentSection = line.replace(/^##\s+/, "").trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content.length > 10) {
      chunks.push({ filename, section: currentSection, content });
    }
  }

  return chunks;
}

async function main() {
  const workspaceDir = process.argv[2] ?? DEFAULT_WORKSPACE;
  const dbPath = process.env.DALI_DB_PATH ?? DEFAULT_DB_PATH;
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
  const model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

  console.log(`Workspace: ${workspaceDir}`);
  console.log(`DB: ${dbPath}`);
  console.log(`Ollama: ${ollamaUrl} (${model})`);
  console.log();

  // Verify Ollama is running
  const embedder = new OllamaEmbedder(ollamaUrl, model);
  const available = await embedder.isAvailable();
  if (!available) {
    console.error("Ollama is not available. Start it with: ollama serve");
    process.exit(1);
  }

  // Open writable DB
  const db = new DaliWritableDB(dbPath);
  if (!db.open()) {
    console.error(`Cannot open DB at ${dbPath}`);
    process.exit(1);
  }

  let totalChunks = 0;
  let totalStored = 0;

  for (const filename of MANAGED_FILES) {
    const filePath = path.join(workspaceDir, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${filename} — not found`);
      continue;
    }

    const text = fs.readFileSync(filePath, "utf-8");
    const chunks = chunkBySection(filename, text);
    totalChunks += chunks.length;

    console.log(`${filename}: ${chunks.length} chunks`);

    for (const chunk of chunks) {
      const summary = `[${chunk.filename}] ${chunk.section}`;

      // Store memory
      const id = db.store({
        type: "conversation",
        content: chunk.content,
        summary,
        project: "openclaw",
        tags: ["workspace", chunk.filename.replace(".md", "").toLowerCase()],
        metadata: { source: chunk.filename, section: chunk.section },
      });

      if (!id) {
        console.error(`  Failed to store chunk: ${summary}`);
        continue;
      }

      // Generate and store embedding
      try {
        const textToEmbed = `${summary}\n\n${chunk.content}`;
        const embedding = await embedder.embed(textToEmbed);
        db.insertEmbedding(id, embedding);
        totalStored++;
        console.log(`  Stored: ${summary}`);
      } catch (err) {
        console.error(`  Embedding failed for ${summary}: ${err}`);
      }
    }
  }

  db.close();

  console.log();
  console.log(`Done: ${totalStored}/${totalChunks} chunks indexed into Dali.`);

  // Create backup and stub files
  if (totalStored > 0) {
    console.log();
    console.log("Creating backups and stubs...");

    for (const filename of MANAGED_FILES) {
      const filePath = path.join(workspaceDir, filename);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      // Backup
      const backupPath = path.join(workspaceDir, `${filename}.pre-dali.bak`);
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
        console.log(`  Backed up: ${filename} → ${filename}.pre-dali.bak`);
      } else {
        console.log(`  Backup already exists: ${filename}.pre-dali.bak`);
      }

      // Stub
      const stubContent = `# ${filename.replace(".md", "")}\n\nManaged by Dali. Use \`dali_search\` tool to query memories.\n`;
      fs.writeFileSync(filePath, stubContent, "utf-8");
      console.log(`  Stubbed: ${filename}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
