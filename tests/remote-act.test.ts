import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// decideApproval (phone tap / voice "yes") through the real modules in a child process: one clip waiting in a temp studio dir,
// a fake Supabase that returns no prospects. Owner scoping itself happens in /api/remote (ownerClient(device.userId)).
const root = path.join(import.meta.dirname, "..");
const mod = (p: string) => JSON.stringify(pathToFileURL(path.join(root, p)).href);

async function child(body: string, thumb = true) {
  const studio = await mkdtemp(path.join(tmpdir(), "orbit-ract-"));
  await mkdir(path.join(studio, "jobs"), { recursive: true });
  await mkdir(path.join(studio, "clips"), { recursive: true });
  if (thumb) await writeFile(path.join(studio, "clips", "t.jpg"), "jpg");
  const clip = { id: "clip-1", start: 10, end: 40, title: "t", hook: "h", reason: "r", score: 0.8, status: "ready", ...(thumb && { thumb: "clips/t.jpg" }) };
  await writeFile(path.join(studio, "jobs", "lq3k2a-abc123.json"), JSON.stringify({ v: 1, id: "lq3k2a-abc123", source: "a.mp4", createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z", status: "done", progress: 1, step: "done", warnings: [], clips: [clip], options: { count: 5, maxSec: 45, captions: true } }));
  const code = `const sb = { from: () => { const c = { select: () => c, eq: () => c, not: () => c, in: () => c, limit: () => c, then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad) }; return c; } };
const { decideApproval } = await import(${mod("src/lib/remote-act.ts")});
const { pendingApprovals } = await import(${mod("src/lib/remote.ts")});
const { getJob } = await import(${mod("src/lib/clips/factory.ts")});
const act = async (...a) => { const r = await decideApproval(sb, "owner-1", ...a); return { status: r.status, ...(await r.json()) }; };
const status = async () => (await getJob("lq3k2a-abc123")).clips[0].status;
const [item] = await pendingApprovals(sb);
${body}
process.exit(0);`;
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-ract-data-"));
  const env = { ...process.env, ORBIT_DATA_DIR: dir, ORBIT_STUDIO_DIR: studio, RESEND_API_KEY: "", ORBIT_MAIL_FROM: "" };
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env, timeout: 60_000 });
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test("approve needs the exact echo: wrong hash, wrong kind or no echo leave the clip waiting", { timeout: 90_000 }, async () => {
  const got = await child(`const out = {
  noEcho: await act(item.id, "approve", null),
  wrongKind: await act(item.id, "approve", { kind: "send", seen: item.seen }),
  wrongHash: await act(item.id, "approve", { kind: "clip", seen: "0000000000000000" }),
  unknownId: await act("not-an-id", "approve", { kind: "clip", seen: item.seen }),
};
out.after = await status();
console.log(JSON.stringify(out));`);
  for (const k of ["noEcho", "wrongKind", "wrongHash", "unknownId"]) { assert.equal(got[k].status, 409, k); assert.equal(got[k].ok, undefined, k); }
  assert.match(got.wrongHash.error, /changed since you saw it/);
  assert.match(got.unknownId.error, /no longer waiting/);
  assert.equal(got.after, "ready");
});

test("the right echo approves once; a replay of the same tap is refused", { timeout: 90_000 }, async () => {
  const got = await child(`const echo = { kind: "clip", seen: item.seen };
const first = await act(item.id, "approve", echo);
const after = await status();
const replay = await act(item.id, "approve", echo);
const replayReject = await act(item.id, "reject", echo);
console.log(JSON.stringify({ first, after, replay, replayReject, final: await status() }));`);
  assert.deepEqual(got.first, { status: 200, ok: true, message: "Approved" });
  assert.equal(got.after, "approved");
  assert.equal(got.replay.status, 409);
  assert.equal(got.replayReject.status, 409);
  assert.equal(got.final, "approved", "a replayed reject can't flip an approved clip");
});

test("reject works from the phone; a stale echo after the clip changed is refused", { timeout: 90_000 }, async () => {
  const got = await child(`const stale = { kind: "clip", seen: item.seen };
const job = await getJob("lq3k2a-abc123");
const { updateClip } = await import(${mod("src/lib/clips/factory.ts")});
await updateClip(job, job.clips[0], { title: "renamed on the PC" });
const staleTry = await act(item.id, "approve", stale);
const [fresh] = await pendingApprovals(sb);
const rej = await act(fresh.id, "reject", { kind: "clip", seen: fresh.seen });
console.log(JSON.stringify({ staleTry, rej, final: await status() }));`);
  assert.equal(got.staleTry.status, 409);
  assert.deepEqual(got.rej, { status: 200, ok: true, message: "Rejected" });
  assert.equal(got.final, "rejected");
});

test("no preview file on disk: the phone can't approve what he couldn't see", { timeout: 90_000 }, async () => {
  const got = await child(`const r = await act(item.id, "approve", { kind: "clip", seen: item.seen });
console.log(JSON.stringify({ r, final: await status() }));`, false);
  assert.equal(got.r.status, 409);
  assert.match(got.r.error, /Open it on the PC/);
  assert.equal(got.final, "ready");
});
