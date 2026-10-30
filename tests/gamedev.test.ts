import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_WORLD, validateDevWorld, type DevWorld } from "../src/lib/devworld-pure.ts";
import { assetIssues, contractBrief, normalizeEvidence, productionReady, releaseGaps, workSteps, nextStep, type Asset, type Evidence, type Release } from "../src/lib/gamedev-pure.ts";

const ev = (p: Partial<Evidence>): Evidence => ({ id: "e1", game: "pet-sim", kind: "runtime", outcome: "pass", env: "Studio", build: "v12", actions: "walked to shop", summary: "ok", at: "2026-10-01T00:00:00.000Z", ...p });

test("contract brief reads only the one game: no context leaks between games", () => {
  const w: DevWorld = structuredClone(SEED_WORLD);
  w.games[0].contract = { engine: "Studio 650", repo: "place 123", build: "v12" };
  const other = { ...w.games[0], id: "x", name: "Other", contract: { repo: "SECRET-REPO" } };
  const brief = contractBrief(w.games[0]);
  assert.match(brief, /place 123/); assert.match(brief, /v12/);
  assert.doesNotMatch(brief, /SECRET-REPO/);
  assert.doesNotMatch(contractBrief(other), /place 123/);
});

test("contract round-trips through validation; empty contract is dropped", () => {
  const w: DevWorld = structuredClone(SEED_WORLD);
  w.games[0].contract = { engine: " Studio ", milestone: "" };
  const r = validateDevWorld(w); assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.world.games[0].contract, { engine: "Studio" });
});

test("an unexecuted run is never passed; static/simulated can't pass; personas never claim retention", () => {
  assert.equal(normalizeEvidence(ev({ actions: "" })).outcome, "not_run");
  assert.equal(normalizeEvidence(ev({ build: "" })).outcome, "not_run");
  assert.equal(normalizeEvidence(ev({})).outcome, "pass");
  assert.equal(normalizeEvidence(ev({ kind: "static" })).outcome, "notes");
  assert.equal(normalizeEvidence(ev({ kind: "simulated" })).outcome, "notes");
  assert.match(normalizeEvidence(ev({ kind: "simulated", outcome: "notes", summary: "D1 retention 40%" })).summary, /not a retention measurement/);
  assert.equal(normalizeEvidence(ev({ kind: "player", summary: "players came back" })).summary, "players came back");
});

test("validation normalises evidence, drops orphans and rejects bad kinds", () => {
  const w = structuredClone(SEED_WORLD) as DevWorld;
  w.evidence = [ev({ kind: "simulated" }), ev({ id: "e2", game: "gone" })];
  const r = validateDevWorld(w); assert.ok(r.ok);
  if (r.ok) { assert.equal(r.world.evidence?.length, 1); assert.equal(r.world.evidence?.[0].outcome, "notes"); }
  const bad = structuredClone(SEED_WORLD) as DevWorld; bad.evidence = [ev({ kind: "vibes" as never })];
  const b = validateDevWorld(bad); assert.equal(b.ok, false);
});

test("work steps: evidence → change → checks after the change → review", () => {
  const bug = { id: "b1" };
  assert.equal(nextStep(workSteps(bug, undefined, [])), "evidence");
  const repro = ev({ bugId: "b1", outcome: "fail", at: "2026-10-01T00:00:00.000Z" });
  assert.equal(nextStep(workSteps(bug, undefined, [repro])), "change");
  const trail = { bugId: "b1", sessionIds: [], fix: { text: "x", state: "proposed" as const, at: "2026-10-02T00:00:00.000Z" } };
  assert.equal(nextStep(workSteps(bug, trail, [repro])), "checks");
  const after = ev({ id: "e2", bugId: "b1", at: "2026-10-03T00:00:00.000Z" });
  assert.equal(nextStep(workSteps(bug, trail, [repro, after])), "review");
  assert.equal(nextStep(workSteps(bug, { ...trail, fix: { ...trail.fix, state: "reviewed" } }, [repro, after])), null);
  assert.equal(workSteps(bug, trail, [repro, { ...after, outcome: "not_run" }]).checks, false);
});

test("asset checks: preview, missing licence or size is never production-ready", () => {
  const a: Asset = { id: "a1", game: "pet-sim", name: "Egg", width: 512, height: 512, format: "png", source: "Higgsfield", license: "owned", use: "shop icon", preview: false };
  assert.ok(productionReady(a, "roblox"));
  assert.deepEqual(assetIssues({ ...a, preview: true }, "roblox"), ["preview"]);
  assert.ok(assetIssues({ ...a, width: 2048 }, "roblox").includes("tooLarge"));
  assert.ok(productionReady({ ...a, width: 2048 }, "web"));
  assert.ok(assetIssues({ ...a, license: "" }, "roblox").includes("license"));
  assert.ok(assetIssues({ ...a, license: "CC BY-NC" }, "roblox").includes("licenseLimited"));
  assert.ok(assetIssues({ ...a, width: undefined }, "roblox").includes("dimensions"));
});

test("release package needs build, rollback, done checklist and passing runtime evidence on that build", () => {
  const w = structuredClone(SEED_WORLD) as DevWorld;
  const r: Release = { id: "r1", game: "pet-sim", build: "v12", changes: "shop fix", issues: "", rollback: "v11", checklist: [{ text: "x", done: true }], evidenceIds: ["e1"], at: "2026-10-01T00:00:00.000Z" };
  w.bugs = w.bugs.filter((b) => b.severity !== "crash");
  assert.deepEqual(releaseGaps(r, { ...w, evidence: [ev({})] }), []);
  assert.ok(releaseGaps(r, { ...w, evidence: [ev({ build: "v11" })] }).includes("evidence"));
  assert.ok(releaseGaps(r, { ...w, evidence: [ev({ kind: "simulated", outcome: "notes" })] }).includes("evidence"));
  assert.ok(releaseGaps({ ...r, rollback: "", checklist: [{ text: "x", done: false }] }, { ...w, evidence: [ev({})] }).includes("checklist"));
});
