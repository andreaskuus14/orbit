import { test } from "node:test";
import assert from "node:assert/strict";
import { isGoAhead, namedWorkspace, wsConfirmOffer, wsWriteBlocked } from "../src/lib/ws-intent-pure.ts";

const workspaces = ["hearth-rye-v2", "snake-game"];
const now = 1_000_000_000;
const pending = { workspace: "hearth-rye-v2", at: now - 60_000 };

test("a named workspace (fuzzy) plus a broader verb is a build request", () => {
  assert.equal(namedWorkspace("upgrade herath and thing", workspaces), "hearth-rye-v2");
  assert.equal(wsWriteBlocked("upgrade herath and thing", false, { workspaces, target: "hearth-rye-v2" }), null);
  for (const q of ["polish the hearth rye site", "redesign my portfolio page", "täienda veebilehte", "kujunda leht ümber"]) assert.equal(wsWriteBlocked(q, false, { workspaces }), null, q);
  assert.equal(namedWorkspace("upgrade the weather thing", workspaces), null);
});

test("a short yes confirms CORE's pending offer, for that workspace only", () => {
  for (const q of ["yes do it", "Yes", "go ahead", "jah", "tee ära", "Build it", "Ehita see", "ok"]) {
    assert.ok(isGoAhead(q), q);
    assert.equal(wsWriteBlocked(q, false, { workspaces, pending, now, target: "hearth-rye-v2" }), null, q);
  }
  assert.match(wsWriteBlocked("yes do it", false, { workspaces, pending, now, target: "snake-game" })!, /only confirmed/);
  assert.equal(wsWriteBlocked("yes", false, { workspaces, pending: { ...pending, at: now - 31 * 60_000 }, now, target: "hearth-rye-v2" }), null); // Operator mode: no offer needed
});

test("Operator mode: a follow-up in a build chat builds, no Build it offer", () => {
  for (const q of ["Only the new site", "find a way to make them yourselves", "make a diffrent name", "yes"]) assert.equal(wsWriteBlocked(q, false, { workspaces, target: "gritstone-climbing-demo" }), null, q);
});

test("negations, questions and taint stay blocked", () => {
  const g = { workspaces, pending, now, target: "hearth-rye-v2" };
  for (const q of ["don't build it", "not now", "Mitte praegu", "ära tee seda", "how would you upgrade hearth rye?", "kas sa uuendaksid lehte?"]) {
    const r = wsWriteBlocked(q, false, g);
    assert.ok(r, q);
    assert.equal(wsConfirmOffer(r!), null, q);
  }
  assert.ok(wsWriteBlocked("yes do it", true, g));
  assert.ok(wsWriteBlocked("upgrade the hearth rye website", true, g));
});
