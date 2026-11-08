import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyProjectsChanged, watchProjects } from "../src/lib/project-list.ts";

test("project list loads on open and again after every create/change notice, until closed", () => {
  const bus = new EventTarget();
  let loads = 0;
  const off = watchProjects(() => { loads++; }, bus);
  assert.equal(loads, 1, "loads when the desk opens");
  notifyProjectsChanged(bus); notifyProjectsChanged(bus);
  assert.equal(loads, 3, "reloads after each new or changed project");
  off(); notifyProjectsChanged(bus);
  assert.equal(loads, 3, "a hidden or closed desk stops listening");
});

