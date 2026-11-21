import { MEMORY_COLUMNS } from "./memory-search.ts";

// Shared by the JSON export (backup.ts) and the restic nightly backup (scripts/backup-run.ts).
// Every user-owned table (supabase/migrations): [table, columns, stable order column for paging, owner column]
export const TABLES: [string, string, string, string][] = [
  ["profiles", "*", "id", "id"],
  ["memories", MEMORY_COLUMNS, "id", "user_id"], // not "*": skips the embedding vector and full-text index
  ["memory_links", "*", "id", "user_id"],
  ["conversations", "*", "id", "user_id"],
  ["messages", "*", "id", "user_id"],
  ["tasks", "*", "id", "user_id"], // includes trace and pending (actions awaiting approval)
  ["proposals", "*", "id", "user_id"],
  ["core_playbook", "*", "user_id", "user_id"],
  ["automations", "*", "id", "user_id"],
  ["agents", "*", "id", "user_id"],
  ["projects", "*", "id", "user_id"],
  ["feeds", "*", "id", "user_id"],
  ["articles", "*", "id", "user_id"],
  ["briefings", "*", "id", "user_id"],
  ["game_saves", "*", "game", "user_id"],
  ["events", "*", "id", "user_id"],
  ["usage", "*", "id", "user_id"],
  ["job_runs", "*", "id", "user_id"],
  ["memory_facts", "*", "id", "user_id"], // migration 0008 (skipped until it is applied)
  ["goals", "*", "id", "user_id"], // 0010
  ["prospects", "*", "id", "user_id"], // 0011
  ["missions", "*", "id", "user_id"], // 0020
];
