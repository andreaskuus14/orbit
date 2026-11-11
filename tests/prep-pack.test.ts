// D05: a synthetic architecture-programme prep pack. Every name, URL and date here is invented test data, not real admission info.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepPack, prepMarkdown, type Requirement } from "../src/lib/prep-pack-pure.ts";

const now = Date.parse("2026-11-09T08:00:00Z");
const src = (read = "2026-11-01") => ({ title: "Synthetic Tech University: Architecture admission (fixture)", url: "https://example.test/admission/architecture", read });
const reqs: Requirement[] = [
  { id: "portfolio", label: "Portfolio (PDF, max 20 pages)", match: ["portfolio"], source: src(), due: "2027-03-15T21:59:00Z" },
  { id: "diploma", label: "Upper-secondary diploma", match: ["diploma", "lõputunnistus"], source: src(), due: "2027-06-30T20:59:00Z" },
  { id: "motivation", label: "Motivation letter", match: ["motivation", "motivatsioon"], source: src(), due: "2027-03-15T21:59:00Z" },
  { id: "drawing", label: "Drawing test registration", match: ["drawing-test"], source: src(), due: "2026-11-01T21:59:00Z" },
  { id: "english", label: "English certificate (B2)", match: ["ielts", "english-cert"], source: src(), due: "2027-03-15T21:59:00Z", optional: true },
  { id: "fee", label: "Application fee receipt", match: ["fee"] }, // copied from a forum post: no source
  { id: "interview", label: "Interview slot", match: ["interview"], source: src(), due: "spring 2027" },
  { id: "id", label: "Copy of ID document", match: ["id-copy"], source: src("2026-09-01") }, // page read 69 days ago
  { id: "math", label: "Mathematics exam result", match: ["math"], source: src(), due: "2027-06-30T20:59:00Z", dueConfirmed: false },
];
const files = [{ name: "Portfolio_v3_Andreas.pdf" }, { name: "motivatsioonikiri.docx" }, { name: "id-copy.jpg" }];

test("each requirement gets a status, its file, days left and the source it came from", () => {
  const by = Object.fromEntries(prepPack(reqs, files, now).map((i) => [i.id, i]));
  assert.equal(by.portfolio.status, "ready"); assert.equal(by.portfolio.file, "Portfolio_v3_Andreas.pdf");
  assert.equal(by.motivation.status, "ready"); // Estonian file name matched
  assert.equal(by.diploma.status, "missing"); assert.equal(by.diploma.daysLeft, 234);
  assert.equal(by.drawing.status, "overdue"); assert.match(by.drawing.why, /passed 7 day/);
  assert.equal(by.english.status, "missing"); assert.equal(by.english.optional, true);
  assert.equal(by.portfolio.cite?.url, "https://example.test/admission/architecture");
});

test("nothing is guessed: no source, a stale source, a non-date deadline or an unconfirmed date are unresolved, even with a file", () => {
  const by = Object.fromEntries(prepPack(reqs, files, now).map((i) => [i.id, i]));
  assert.equal(by.fee.status, "unresolved"); assert.match(by.fee.why, /no source/);
  assert.equal(by.id.status, "unresolved"); assert.match(by.id.why, /more than 30 days/); // id-copy.jpg exists, but the page may have changed
  assert.equal(by.interview.status, "unresolved"); assert.match(by.interview.why, /isn't a date/);
  assert.equal(by.math.status, "unresolved"); assert.match(by.math.why, /not confirmed/);
});

test("markdown: urgent first, open count, every line cites its source and read date", () => {
  const md = prepMarkdown("Architecture application (synthetic)", prepPack(reqs, files, now));
  const lines = md.split("\n").filter((l) => l.startsWith("- "));
  assert.match(lines[0], /Drawing test registration\*\*: overdue/);
  assert.match(md, /6 required item\(s\) still open/); // diploma, drawing, fee, interview, id, math (english is optional)
  for (const l of lines.filter((l) => !l.includes("Application fee"))) assert.match(l, /Source: \[.+\]\(https:\/\/example\.test\/.+\), read 2026-/);
  assert.doesNotMatch(lines.find((l) => l.includes("Application fee"))!, /Source:/);
  assert.match(md, /- \[x\] \*\*Portfolio/);
  assert.equal(prepMarkdown("Done", prepPack([reqs[0]], files, now)).includes("Every required item is ready."), true);
});
