import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-bgresume-"));
const { resumeRows } = await import("../src/lib/bg-resume.ts");

// A fake Supabase that honours order + limit the way Postgres does, over a 300-message chat.
function chat(n: number) { return chatOf(n, true); }
function chatOf(n: number, marks = false) {
  const rows = Array.from({ length: n }, (_, i) => ({ i, role: i % 2 ? "assistant" : "user", content: `message ${i}`, created_at: new Date(Date.UTC(2026, 10, 5, 8, 0, i)).toISOString() }));
  if (marks) rows[10] = { ...rows[10], content: "An old request." };
  if (marks) rows[296] = { ...rows[296], content: "Decision: the site is blue, not green." }; // a late correction
  if (marks) rows[298] = { ...rows[298], content: "Build the golf site now." }; // the request the background turn was running
  const q = { asc: true, lim: Infinity };
  const b = {
    select: () => b, eq: () => b,
    order: (_c: string, o: { ascending: boolean }) => ((q.asc = o.ascending), b),
    limit: (n2: number) => ((q.lim = n2), b),
    then: (ok: (r: unknown) => void) => ok({ data: [...rows].sort((x, y) => (q.asc ? 1 : -1) * x.created_at.localeCompare(y.created_at)).slice(0, q.lim).map(({ role, content }) => ({ role, content })), error: null }),
  };
  return { from: () => b } as never;
}

test("a restart in a 300-message chat resumes with the newest messages, in order, ending at the request", async () => {
  const h = await resumeRows(chat(300), "c1", "Build the golf site now.");
  assert.equal(h.length, 60);
  assert.equal(h.at(-1)!.content, "Build the golf site now.");
  assert.ok(h.some((m) => m.content.startsWith("Decision: the site is blue")), "the late correction survives");
  assert.deepEqual(h.slice(0, 2).map((m) => m.content), ["message 239", "message 240"]); // time order, oldest of the window first
});

test("a short chat resumes whole, in order, up to the request", async () => {
  const h = await resumeRows(chat(300), "c1", "An old request."); // the window is the newest 200: message 10 is outside it
  assert.deepEqual(h, []); // bg-resume then reports "the request is no longer in the chat" rather than resuming the wrong turn
  const short = await resumeRows(chatOf(12), "c1", "message 10");
  assert.deepEqual(short.map((m) => m.content), Array.from({ length: 11 }, (_, i) => `message ${i}`));
});
