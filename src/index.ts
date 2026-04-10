import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createServer } from "./server.js";

const dbPath =
  process.env.DALI_DB_PATH ?? join(homedir(), ".claude", "dali", "dali.db");
const defaultProject =
  process.env.DALI_PROJECT ?? basename(process.cwd());

const server = createServer(dbPath, defaultProject);
const transport = new StdioServerTransport();

await server.connect(transport);
console.error(`[dali] project=${defaultProject} db=${dbPath}`);
