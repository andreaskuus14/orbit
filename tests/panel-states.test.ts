import { test } from "node:test";
import assert from "node:assert/strict";
import { pickState, schedState } from "../src/lib/panel-states-pure.ts";

test("schedState never reports unconfigured while checking", () => {
  assert.equal(schedState({}), "checking");
  assert.equal(schedState({ scheduled: true }), "configured");
  assert.equal(schedState({ scheduled: false }), "unconfigured");
  assert.equal(schedState({ failed: "network" }), "unavailable");
  assert.equal(schedState({ scheduled: false, failed: "server" }), "error");
});

test("pickState distinguishes loading, no game, gone and ready", () => {
  const games = [{ id: "a" }];
  assert.equal(pickState({ loaded: false, games: [], selected: null }), "loading");
  assert.equal(pickState({ loaded: false, loadErr: "x", games: [], selected: "a" }), "failed");
  assert.equal(pickState({ loaded: true, games: [], selected: null }), "empty");
  assert.equal(pickState({ loaded: true, games, selected: null }), "none");
  assert.equal(pickState({ loaded: true, games, selected: "b" }), "unavailable");
  assert.equal(pickState({ loaded: true, games, selected: "a" }), "ready");
});
