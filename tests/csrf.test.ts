import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSiteBlocked } from "../src/lib/csrf.ts";

test("csrf: cross-site writes to /api are blocked, same-origin and headerless pass", () => {
  const host = "localhost:3000";
  assert.equal(crossSiteBlocked("POST", "/api/insights", { secFetchSite: "same-origin", origin: "http://localhost:3000", host }), false);
  assert.equal(crossSiteBlocked("POST", "/api/insights", { secFetchSite: "cross-site", host }), true);
  assert.equal(crossSiteBlocked("POST", "/api/insights", { secFetchSite: "same-site", host }), true);
  assert.equal(crossSiteBlocked("DELETE", "/api/x", { origin: "https://evil.example", host }), true);
  assert.equal(crossSiteBlocked("POST", "/api/x", { origin: "null", host }), true);
  assert.equal(crossSiteBlocked("POST", "/api/x", { origin: "http://localhost:3000", host }), false);
  assert.equal(crossSiteBlocked("POST", "/api/x", {}), false); // local tools
  assert.equal(crossSiteBlocked("GET", "/api/x", { secFetchSite: "cross-site", host }), false);
  assert.equal(crossSiteBlocked("POST", "/login", { secFetchSite: "cross-site", host }), false);
});
