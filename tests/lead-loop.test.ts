import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoExcluded, combineTries, domainGuesses, domainUrls, fetchErrorState, finishPitch, honestyIssues, isListing, isNaturalPerson, leadLabel, nextStep, pageNames, parseCandidates, parseSearch, pitchProblems, scoreNoWebsite, toCandidate, withoutStats } from "../src/lib/lead-loop-pure.ts";
import { placeholderIn } from "../src/lib/business-pure.ts";
import { HONEST_IDEA_SYSTEM, IDEA_SYSTEM } from "../src/lib/site-idea-pure.ts";

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
  assert.equal(parseSearch('{"website":"kask.ee (official)","checked":[]}'), null); // unparsable website fails closed
  assert.equal(parseSearch('{"website":"https://a.ee https://b.ee","checked":[]}'), null);
  assert.equal(parseSearch('{"website":null,"checked":[]}')?.website, null);
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

test("review #1: scheme-less website counts as a site; two 'other' results don't pass; search + a 'none' needed", () => {
  assert.equal(parseSearch('{"website":"www.kask.ee","checked":["kask.ee/kontakt"]}')?.website, "https://www.kask.ee/");
  assert.deepEqual(parseSearch('{"website":null,"checked":["kask.ee/kontakt"]}')?.links, ["https://kask.ee/kontakt"]);
  const two = scoreNoWebsite({ website: null, links: [] }, [{ domain: "a.ee", state: "other" }, { domain: "a.com", state: "other" }]);
  assert.equal(two.pass, false);
  assert.equal(scoreNoWebsite({ website: null, links: [] }, [{ domain: "a.ee", state: "dead" }, { domain: "a.com", state: "dead" }]).pass, false);
  assert.equal(scoreNoWebsite({ website: null, links: [] }, [{ domain: "a.ee", state: "none" }]).pass, true);
});

test("review #2: http/www tries, error states, title, likely vs proven", () => {
  assert.deepEqual(domainUrls("kask.ee"), ["https://kask.ee", "http://kask.ee", "https://www.kask.ee", "http://www.kask.ee"]);
  assert.equal(fetchErrorState("ENOTFOUND", ""), "none");
  assert.equal(fetchErrorState(undefined, "The site answered 403"), "maybe");
  assert.equal(fetchErrorState("UND_ERR_CONNECT_TIMEOUT", "timeout"), "maybe");
  assert.equal(fetchErrorState("CERT_HAS_EXPIRED", "certificate has expired"), "maybe");
  assert.equal(fetchErrorState("ECONNREFUSED", ""), "dead");
  assert.equal(combineTries(["none", "none", "maybe", "none"]), "maybe"); // www answering with an error isn't "no DNS"
  assert.equal(combineTries(["none", "none", "none", "none"]), "none");
  assert.ok(pageNames("Kask Pagariäri", "Welcome", "Pagariäri Kask | Tartu"));
  const maybe = scoreNoWebsite({ website: null, links: [] }, [{ domain: "a.ee", state: "none" }, { domain: "a.com", state: "none" }, { domain: "b.ee", state: "maybe" }]);
  assert.ok(maybe.confidence < 80 && maybe.pass);
  assert.match(leadLabel({ stage: "checked", confidence: 79 }), /likely 79%/);
  assert.match(leadLabel({ stage: "checked", confidence: 90 }), /proven 90%/);
});

test("review #3: Auto exclusion lives on the row and both Auto paths use it", () => {
  assert.ok(autoExcluded({ source: "lead-loop" }) && !autoExcluded({ source: null }) && autoExcluded({})); // B8: any non-null source, and an unknown one, fails closed
  const auto = readFileSync(new URL("../src/lib/autonomy.ts", import.meta.url), "utf8");
  assert.equal((auto.match(/autoExcluded\(/g) ?? []).length, 2); // sendCandidates and fireSend
  assert.ok(!/prospect-crm/.test(auto.slice(auto.indexOf("async function sendCandidates"), auto.indexOf("async function fireSend")))); // not the CRM file
  const route = readFileSync(new URL("../src/app/api/business/leads/route.ts", import.meta.url), "utf8");
  assert.match(route, /source: LEAD_SOURCE/);
  assert.match(route, /drafted_at: null/);
  assert.ok(!/resendMail|sendDraft|api\.resend/.test(route)); // the loop never sends
});

test("review #4: placeholders block sending; Estonian tells and spaced hyphens are linted", () => {
  assert.equal(placeholderIn(finishPitch("x", "English")), "[postal address]");
  assert.equal(placeholderIn("Tere!\nAndreas\nTartu mnt 1, Tallinn"), null);
  const send = readFileSync(new URL("../src/lib/business-send.ts", import.meta.url), "utf8");
  assert.match(send, /placeholderIn\(p\.draft\)/);
  const good = "Tere! Teil on Tartus pagariäri, aga veebilehte ma ei leidnud. Tegin teile tasuta näidiskodulehe, kus on teie pagariäri ja kontakt. Kas tohin teile lingi saata?";
  assert.ok(pitchProblems(good.replace("Tegin", "Tänapäeva maailmas tegin")).some((p) => p.includes("AI tell")));
  assert.ok(pitchProblems(good.replace(", aga", " - aga")).some((p) => p.includes("dash")));
  assert.ok(!pitchProblems("Tere! Pagar 24 on teie ettevõte, aga veebilehte ma ei leidnud. Tegin teile tasuta näidiskodulehe ja kontakti. Kas tohin lingi saata?", "Pagar 24").length); // #6 digits in the name
});

test("review #5: honest demo brief drops stat labels; honesty lint issues are kept", () => {
  assert.ok(IDEA_SYSTEM.includes("short stat") && !HONEST_IDEA_SYSTEM.includes("short stat"));
  const d = withoutStats({ sections: [{ kind: "features", items: [{ label: "72 h", title: "a", body: "b" }] }, { kind: "hero" }] }) as { sections: { items?: object[] }[] };
  assert.deepEqual(d.sections[0].items, [{ title: "a", body: "b" }]);
  assert.deepEqual(honestyIssues(["x: missing <meta name=viewport", "y: a review/quote block not marked as the owner's: never invent reviews"]).length, 1);
});

test("review #6: re-run resumes the unfinished step", () => {
  assert.equal(nextStep({ stage: "checked" }), "demo");
  assert.equal(nextStep({ stage: "demo", demo: { slug: "s", preview: "p", issues: ["invented"] } }), "demo");
  assert.equal(nextStep({ stage: "demo", demo: { slug: "s", preview: "p" } }), "pitch");
  assert.equal(nextStep({ stage: "pitched", demo: { slug: "s", preview: "p" } }), "done");
});

test("review #7 + #8: Estonian header row; FIE is a natural person", () => {
  assert.deepEqual(parseCandidates("Nimi;Linn;Tegevusala\nKask OÜ;Tartu;pagar"), [{ name: "Kask OÜ", city: "Tartu", category: "pagar" }]);
  assert.ok(isNaturalPerson("Mari Kask FIE") && isNaturalPerson("FIE Mari") && !isNaturalPerson("Fiesta OÜ"));
});

test("B8 parseMapsCsv: gosom headers, business fields only, dedupe, cap", async () => {
  const { MAPS_MAX, parseMapsCsv, mapsNotes, autoExcluded: ex } = await import("../src/lib/lead-loop-pure.ts");
  const head = "input_id,link,title,category,address,open_hours,website,phone,review_count,review_rating,complete_address,owner,user_reviews,emails";
  const row = (n: string, city = "Tartu") => `q1,https://www.google.com/maps/place/x,${n},Hair salon,"Rüütli 1, Tartu",{},https://mari.ee,+372 5555 5555,12,4.8,"{""city"":""${city}""}","{""name"":""Mari Maasikas""}","[{""Name"":""Jaan Tamm"",""Description"":""great,\nnice""}]",mari@gmail.com`;
  const r = parseMapsCsv(`﻿${head}\n${row("Mari FIE")}\n${row("Mari FIE")}\n${row("Lumi OÜ", "Tallinn")}\n`)!;
  assert.deepEqual(r.leads[0], { name: "Mari FIE", category: "Hair salon", address: "Rüütli 1, Tartu", city: "Tartu", phone: "+372 5555 5555", website: "https://mari.ee", maps: "https://www.google.com/maps/place/x" });
  assert.equal(r.leads.length, 2); assert.equal(r.over, 0);
  const all = JSON.stringify(r) + mapsNotes(r.leads[0]);
  for (const bad of ["Jaan Tamm", "great", "Maasikas", "gmail", "4.8"]) assert.ok(!all.includes(bad), bad);
  assert.match(mapsNotes(r.leads[0]), /natural person/); assert.doesNotMatch(mapsNotes(r.leads[1]), /natural person/);
  const big = parseMapsCsv([head, ...Array.from({ length: MAPS_MAX + 7 }, (_, i) => row(`B${i}`))].join("\r\n"))!;
  assert.equal(big.leads.length, MAPS_MAX); assert.equal(big.over, 7);
  assert.equal(parseMapsCsv("name,city\nA,B"), null);
  assert.ok(ex({ source: "maps-import" }) && ex({ source: "lead-loop" }) && ex({ source: "anything" }) && ex({}));
  assert.ok(!ex({ source: null }));
});

test("B8 route: import dedupes against existing prospects and saves source maps-import", () => {
  const src = readFileSync("src/app/api/business/leads/route.ts", "utf8");
  const imp = src.slice(src.indexOf('b.action === "import"'), src.indexOf("const held"));
  assert.match(imp, /duplicateOf\(known/); assert.match(imp, /source: MAPS_SOURCE/); assert.doesNotMatch(imp, /send|askClaude|fetch\(/i);
  assert.match(readFileSync("src/lib/autonomy.ts", "utf8"), /!autoExcluded\(p\)/);
});
