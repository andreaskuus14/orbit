import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTasks } from "../src/lib/ops-tasks-pure.ts";

test("tasks with no project and any agent are all listed, grouped, newest first", () => {
  const t = (id: string, status: string, at: string, pending: { status: string }[] = []) => ({ id, status, created_at: at, pending, project_id: null, agent: "forge" });
  const g = groupTasks([t("a", "done", "2026-10-01"), t("b", "failed", "2026-10-02"), t("c", "done", "2026-10-03"), t("d", "running", "2026-10-04", [{ status: "pending" }]), t("e", "queued", "2026-10-05"), t("f", "cancelled", "2026-10-06"), t("g", "awaiting_approval", "2026-10-07")]);
  assert.deepEqual(g.attention.map((x) => x.id), ["g", "d", "b"]);
  assert.deepEqual(g.active.map((x) => x.id), ["e"]);
  assert.deepEqual(g.done.map((x) => x.id), ["f", "c", "a"]);
});
