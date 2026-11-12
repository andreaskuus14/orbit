import { test } from "node:test";
import assert from "node:assert/strict";
import { domainGuesses, finishPitch, isListing, pageNames, parseCandidates, parseSearch, pitchProblems, scoreNoWebsite, toCandidate } from "../src/lib/lead-loop-pure.ts";

test("parseCandidates: paste lines, CSV with header, quotes, dedupe, Maps URL check", () => {
  assert.deepEqual(parseCandidates("Kask Pagariäri, Tartu, bakery\n\nKask Pagariäri, Tartu, bakery\nLumi OÜ; Tallinn; cleaning"), [
    { name: "Kask Pagariäri", city: "Tartu", category: "bakery" }, { name: "Lumi OÜ", city: "Tallinn", category: "cleaning" }]);
  const csv = 'category,name,maps,city\nsalon,"Juuksur, Mari",https://maps.app.goo.gl/abc,Pärnu\nrepair,Fix,javascript:alert(1),Tartu';
  assert.deepEqual(parseCandidates(csv), [
    { name: "Juuksur, Mari", city: "Pärnu", category: "salon", maps: "https://maps.app.goo.gl/abc" }, { name: "Fix", city: "Tartu", category: "repair" }]);
  assert.equal(parseCandidates(Array.from({ length: 40 }, (_, i) => `B${i}, X, y`).join("\n")).length, 25);
  assert.equal(toCandidate({ city: "x" }), null);
});

test("domainGuesses: accents folded, legal form dropped, joined + hyphen", () => {
  assert.deepEqual(domainGuesses("Kask Pagariäri OÜ"), ["kaskpagariari.ee", "kaskpagariari.com", "kask-pagariari.ee", "kask-pagariari.com"]);
  assert.deepEqual(domainGuesses("Lumi"), ["lumi.ee", "lumi.com"]);
  assert.deepEqual(domainGuesses("OÜ"), []);
});

test("pageNames and isListing", () => {
  assert.ok(pageNames("Kask Pagariäri OÜ", "Tere! PAGARIÄRI Kask avatud"));
  assert.ok(!pageNames("Kask Pagariäri", "Domain for sale"));
  assert.ok(isListing("https://www.facebook.com/kask") && isListing("https://www.1182.ee/x") && isListing("not a url"));
  assert.ok(!isListing("https://kask.ee"));
});

test("parseSearch: listings are not a website; bad JSON is null", () => {
  assert.deepEqual(parseSearch('ok {"website":"https://facebook.com/kask","checked":["https://facebook.com/kask","ftp://x"]}'), { website: null, links: ["https://facebook.com/kask"] });
  assert.equal(parseSearch('{"website":"https://kask.ee/","checked":[]}')?.website, "https://kask.ee/");
  assert.equal(parseSearch("no json"), null);
});

test("scoreNoWebsite: a found site fails; search + DNS needed to pass; never 100", () => {
  const none = [{ domain: "kask.ee", state: "none" as const }, { domain: "kask.com", state: "none" as const }];
  const ok = scoreNoWebsite({ website: null, links: ["https://facebook.com/kask"] }, none);
  assert.deepEqual([ok.pass, ok.confidence], [true, 90]);
  assert.ok(ok.evidence.includes("https://facebook.com/kask") && ok.evidence.includes("https://kask.ee (none)"));
  assert.equal(scoreNoWebsite({ website: "https://kask.ee", links: [] }, none).pass, false);
  assert.equal(scoreNoWebsite({ website: null, links: [] }, [{ domain: "kask.ee", state: "own" }]).pass, false);
  assert.equal(scoreNoWebsite(null, none).pass, false); // DNS alone isn't proof
  assert.equal(scoreNoWebsite({ website: null, links: [] }, [{ domain: "kask.ee", state: "error" }]).pass, false);
  assert.equal(scoreNoWebsite({ website: null, links: [] }, Array(4).fill({ domain: "a.ee", state: "none" })).confidence, 95);
});

test("pitchProblems + finishPitch: cold-email rules", () => {
  const good = "Tere! Nägin, et teete Tartus tellimuskooke, aga veebilehte ei leidnud. Tegin teile tasuta näidiskodulehe, kus on teie koogid ja kontakt. Kas tohin teile lingi saata?";
  assert.deepEqual(pitchProblems(good), []);
  assert.ok(pitchProblems(good.replace(", aga", " — aga")).some((p) => p.includes("dash")));
  assert.ok(pitchProblems(good + " Kas sobib?").some((p) => p.includes("one ask")));
  assert.ok(pitchProblems("I hope this finds you well. " + good).some((p) => p.includes("AI tell")));
  assert.ok(pitchProblems(good.replace("tasuta", "5 € eest")).some((p) => p.includes("numbers")));
  const done = finishPitch("Subject: hi\n" + good, "Estonian");
  assert.ok(!done.startsWith("Subject") && done.includes("stopp") && done.endsWith("[postiaadress]"));
  assert.ok(finishPitch("x", "English").includes("[postal address]"));
});
