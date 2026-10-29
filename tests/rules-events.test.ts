// Standing rules on the events feed: a crash between deciding to run and creating the task never loses or doubles the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";

// rules.ts imports siblings without ".ts" (Next resolves them); teach node the same for this test only.
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } }`));

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-rules-ev-"));
const { tickRules } = await import("../src/lib/rules.ts");
const G = globalThis as unknown as { __orbitDurable: { cursors?: unknown; tracks?: unknown; chain: Promise<unknown> } };
const restart = async () => { await G.__orbitDurable.chain; G.__orbitDurable.cursors = undefined; G.__orbitDurable.tracks = undefined; };

type Row = Record<string, unknown> & { id: number | string };
function fakeSb(tables: Record<string, Row[]>, insert: { hang: boolean }) {
  return { from: (t: string) => {
    let out = [...(tables[t] ??= [])]; let n = Infinity; let ins: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b, single: () => b, is: () => b,
      eq: (c: string, v: unknown) => { out = out.filter((r) => r[c] === v); return b; },
      gt: (c: string, v: number) => { out = out.filter((r) => (r[c] as number) > v); return b; },
      in: (c: string, v: unknown[]) => { out = out.filter((r) => v.includes(r[c])); return b; },
      like: (c: string, p: string) => { out = out.filter((r) => String(r[c]).endsWith(p.slice(1))); return b; },
      order: (_c: string, o?: { ascending: boolean }) => { out.sort((a, z) => (o?.ascending === false ? -1 : 1) * ((a.id as number) - (z.id as number))); return b; },
      limit: (k: number) => { n = k; return b; },
      insert: (r: Row) => { ins = { ...r, id: `task-${tables[t].length + 1}`, status: "done" }; return b; },
      then: (ok: (v: unknown) => unknown) => {
        if (ins) {
          if (insert.hang) return new Promise(() => {}); // the process dies here: the task is never written
          tables[t].push(ins); return Promise.resolve({ data: ins, error: null }).then(ok);
        }
        return Promise.resolve({ data: out.slice(0, n), error: null }).then(ok);
      },
    };
    return b;
  } } as never;
}

const at = () => new Date().toISOString();
const rule = { id: "r1", name: "On save", text: "x", status: "active", by: "owner", created: at(), activeSince: at(), lastRun: null, last: null,
  scope: "", permissions: [], trigger: { type: "event", event: "memory.created" }, action: { kind: "agent", agent: "nova", prompt: "Summarise it" } };
const ev = (id: number) => ({ id, user_id: "u", type: "memory.created", payload: { source: "capture", title: "t" }, created_at: at() });

test("crash after the run is decided, before its task is inserted: created exactly once after restart", async () => {
  await writeFile(path.join(process.env.ORBIT_DATA_DIR!, "rules.json"), JSON.stringify({ rules: [rule] }));
  const tables: Record<string, Row[]> = { events: [ev(1)], tasks: [] }, mode = { hang: false };
  const sb = fakeSb(tables, mode);
  await tickRules(sb, ["u"]); // first run: cursor starts at the newest event
  tables.events.push(ev(2));
  mode.hang = true;
  void tickRules(sb, ["u"]); // takes event 2, decides to run, dies in the insert
  await new Promise((r) => setTimeout(r, 50));
  await restart(); mode.hang = false;
  await tickRules(sb, ["u"]);
  assert.equal(tables.tasks.length, 1);
  assert.match(String(tables.tasks[0].request), /\[event:rules:2\]$/);
  await restart();
  await tickRules(sb, ["u"]); // nothing left to replay
  assert.equal(tables.tasks.length, 1);
});

test("crash after the task was inserted, before the ack: the replay finds the task instead of creating another", async () => {
  await writeFile(path.join(process.env.ORBIT_DATA_DIR!, "rules.json"), JSON.stringify({ rules: [{ ...rule, id: "r2" }] }));
  const tables: Record<string, Row[]> = { events: [ev(10)], tasks: [] }, mode = { hang: false };
  const sb = fakeSb(tables, mode);
  await restart();
  await tickRules(sb, ["u"]);
  tables.events.push(ev(11));
  tables.tasks.push({ id: "pre", user_id: "u", request: "Summarise it [event:rules:11]" }); // made before the crash
  await tickRules(sb, ["u"]);
  assert.equal(tables.tasks.filter((t) => String(t.request).endsWith("[event:rules:11]")).length, 1);
});
