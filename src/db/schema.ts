export const SCHEMA_VERSION = 1;

export const DDL = [
  // Core memories table
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('conversation','decision','file_change','tool_usage')),
    content TEXT NOT NULL,
    summary TEXT,
    session_id TEXT,
    project TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    archived INTEGER NOT NULL DEFAULT 0
  )`,

  // Bridge table: maps memory UUID → integer rowid for vec0
  `CREATE TABLE IF NOT EXISTS memory_vec_map (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE
  )`,

  // vec0 virtual table for vector search
  `CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
    embedding float[768] distance_metric=cosine
  )`,

  // Audit log
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    action_type TEXT NOT NULL,
    tool_name TEXT,
    input TEXT,
    output TEXT,
    session_id TEXT,
    duration_ms INTEGER
  )`,

  // Sessions
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ended_at TEXT,
    summary TEXT
  )`,

  // File changes
  `CREATE TABLE IF NOT EXISTS file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL,
    diff_summary TEXT,
    lines_added INTEGER NOT NULL DEFAULT 0,
    lines_removed INTEGER NOT NULL DEFAULT 0
  )`,

  // Schema version tracking
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action_type)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool_name)`,
  `CREATE INDEX IF NOT EXISTS idx_file_changes_memory ON file_changes(memory_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(file_path)`,
];
