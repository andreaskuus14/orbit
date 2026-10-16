import { test } from "node:test";
import assert from "node:assert/strict";
import { publicOrigin } from "../src/lib/origin-pure.ts";
import { crossSiteBlocked } from "../src/lib/csrf.ts";

test("public origin behind Tailscale Serve", () => {
  const ts = "arvuti.tail22d756.ts.net";
  assert.equal(publicOrigin({ host: "localhost:3000", forwardedHost: ts }, "http://localhost:3000/x"), `https://${ts}`);
  assert.equal(publicOrigin({ host: ts }, "http://localhost:3000/x"), `https://${ts}`);
  assert.equal(publicOrigin({ host: "localhost:3000" }, "http://localhost:3000/x"), "http://localhost:3000");
  assert.equal(publicOrigin({ host: "evil.com/path" }, "http://127.0.0.1:3000/"), "http://127.0.0.1:3000"); // junk host ignored
});

test("CSRF accepts the phone's own origin via X-Forwarded-Host, still blocks other sites", () => {
  const ts = "arvuti.tail22d756.ts.net";
  assert.equal(crossSiteBlocked("POST", "/api/core", { secFetchSite: "same-origin", origin: `https://${ts}`, host: "localhost:3000", forwardedHost: ts }), false);
  assert.equal(crossSiteBlocked("POST", "/api/core", { origin: "https://evil.com", host: "localhost:3000", forwardedHost: ts }), true);
  assert.equal(crossSiteBlocked("POST", "/api/core", { secFetchSite: "cross-site", origin: `https://${ts}`, host: "localhost:3000", forwardedHost: ts }), true);
});
