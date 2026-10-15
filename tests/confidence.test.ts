import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, independentCount, labelFor, countLabels, overallConfidence, confidenceLine, parseJsonArray, parseClaims, parseVerdicts } from "../src/lib/confidence.ts";

test("registrableDomain groups subdomains and handles two-part suffixes", () => {
  assert.equal(registrableDomain("https://www.bbc.co.uk/news/x"), "bbc.co.uk");
  assert.equal(registrableDomain("https://edition.cnn.com/a"), "cnn.com");
  assert.equal(registrableDomain("https://reuters.com"), "reuters.com");
  assert.equal(registrableDomain("ftp://x.com"), null);
  assert.equal(registrableDomain("not a url"), null);
});

test("independentCount counts distinct domains only", () => {
  assert.equal(independentCount(["https://a.cnn.com/1", "https://www.cnn.com/2", "https://bbc.co.uk/x", "junk"]), 2);
});

test("labelFor: Confirmed needs two independent domains; any contradiction is Disputed", () => {
  assert.equal(labelFor(["https://cnn.com/a", "https://reuters.com/b"], []), "Confirmed");
  assert.equal(labelFor(["https://cnn.com/a", "https://edition.cnn.com/b"], []), "Single source");
  assert.equal(labelFor([], []), "Unverified");
  assert.equal(labelFor(["https://cnn.com/a", "https://reuters.com/b"], ["https://ap.org/c"]), "Disputed");
  assert.equal(labelFor([], ["https://ap.org/c"]), "Disputed");
});

test("overallConfidence is deterministic from counts", () => {
  const c = (Confirmed: number, single: number, Disputed: number, Unverified: number) => ({ Confirmed, "Single source": single, Disputed, Unverified });
  assert.equal(overallConfidence(c(5, 1, 0, 0)), "high");
  assert.equal(overallConfidence(c(3, 2, 1, 0)), "medium");
  assert.equal(overallConfidence(c(1, 1, 2, 0)), "low");
  assert.equal(overallConfidence(c(1, 0, 0, 3)), "low");
  assert.equal(overallConfidence(c(0, 0, 0, 0)), "low");
  assert.equal(confidenceLine(countLabels(["Confirmed", "Confirmed", "Single source"])), "Confidence: high — 2 confirmed, 1 single source, 0 disputed, 0 unverified");
});

test("parseJsonArray tolerates fences, prose, wrappers and garbage", () => {
  assert.deepEqual(parseJsonArray('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(parseJsonArray('Here you go: {"claims": [1, 2]} hope it helps'), [1, 2]);
  assert.deepEqual(parseJsonArray("no json here"), []);
  assert.deepEqual(parseJsonArray("[broken"), []);
});

test("parseClaims keeps valid claims, http(s) URLs only, and caps the count", () => {
  const text = '```\n[{"claim":" Rates rose 4% ","sources":["https://a.com/x","javascript:alert(1)","https://a.com/x"]},{"claim":""},{"text":"Alt key","urls":["http://b.org"]},"junk"]\n```';
  assert.deepEqual(parseClaims(text), [
    { claim: "Rates rose 4%", sources: ["https://a.com/x"] },
    { claim: "Alt key", sources: ["http://b.org"] },
  ]);
  assert.equal(parseClaims(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ claim: `c${i}`, sources: [] }))), 8).length, 8);
});

test("parseVerdicts drops out-of-range and duplicate numbers", () => {
  const v = parseVerdicts('[{"claim":1,"supports":[1,2,2,9],"contradicts":["3"]},{"claim":1,"supports":[]},{"claim":5,"supports":[1]}]', 2, 3);
  assert.deepEqual(v, [{ claim: 1, supports: [1, 2], contradicts: [3] }]);
});
