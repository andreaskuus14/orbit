import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMode, parseStealthDomains, robotsAllows, stealthRefusal, waitMs, GAP_S } from "../src/lib/scrape-pure.ts";

test("stealth is per site: only owner-listed domains (and their subdomains) may use it; other modes always pass", () => {
  const allowed = parseStealthDomains(" https://Example.com/path, *.shop.example.org , not a domain ");
  assert.deepEqual(allowed, ["example.com", "shop.example.org"]);
  assert.equal(stealthRefusal(new URL("https://www.example.com/x"), "stealth", allowed), null);
  assert.match(stealthRefusal(new URL("https://evil-example.com/"), "stealth", allowed) ?? "", /Stealth mode is off for evil-example\.com/);
  assert.equal(stealthRefusal(new URL("https://other.net/"), "browser", allowed), null);
  assert.equal(parseMode("STEALTH"), "fast", "unknown spellings fall back to the gentlest mode");
});

test("per-domain gap: stealth waits longest; first request goes at once", () => {
  assert.equal(waitMs(undefined, "stealth", 1000), 0);
  assert.equal(waitMs(0, "stealth", 5000), GAP_S.stealth * 1000 - 5000);
  assert.equal(waitMs(0, "fast", 60_000), 0);
});

test("robots.txt: the * group's Allow/Disallow, longest match wins; other agents' rules don't apply", () => {
  const r = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/press\n# comment\nDisallow: /cart*";
  assert.equal(robotsAllows(r, "/"), true);
  assert.equal(robotsAllows(r, "/private/x"), false);
  assert.equal(robotsAllows(r, "/private/press/kit"), true);
  assert.equal(robotsAllows(r, "/cart/1"), false);
  assert.equal(robotsAllows("", "/anything"), true);
});
