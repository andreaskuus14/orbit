import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  SKILLS, SKILLS_NOTE, LEAD_RULE, deferredTokens, downTier, editedPath, hookOut, isLimitError, loadedTokens, nativeTools, nativeWorkspace, parsePref,
  parseSkill, preCheck, routeTurn, rulePath, sharedPrefix, stableSystem, stripSkills, wsPermissions,
} from "../src/lib/core-mcp-boost-pure.ts";
import { mcpToolList, toolDocs } from "../src/lib/core-mcp-pure.ts";
import { TIERS } from "../src/lib/policy-pure.ts";
import { SITE_PIPELINE } from "../src/lib/site-guide.ts";
import { FOLLOW_THROUGH, leadCheckHint } from "../src/lib/core-operator-pure.ts";

const D = "/data/workspaces/u1/bakery";

test("native workspace: explicit build naming an existing workspace, or a go-ahead to the pending offer; never when tainted", () => {
  const gate = { workspaces: ["bakery", "hearth-rye-v2"] };
  assert.equal(nativeWorkspace("update the hero text on my bakery site", gate, false), "bakery");
  assert.equal(nativeWorkspace("update the hero text on my bakery site", gate, true), null);
  assert.equal(nativeWorkspace("what is on my bakery site?", gate, false), null);
  assert.equal(nativeWorkspace("build a new portfolio site", gate, false), null); // no existing workspace: ws_create path as before
  assert.equal(nativeWorkspace("yes do it", { ...gate, pending: { workspace: "hearth-rye-v2", at: 1000 } }, false, 2000), "hearth-rye-v2");
  assert.equal(nativeWorkspace("yes do it", { ...gate, pending: { workspace: "hearth-rye-v2", at: 0 } }, false, 3_600_000), null);
  assert.deepEqual(nativeTools(false), ["ToolSearch", "Skill"]);
  assert.ok(nativeTools(true).includes("Edit") && nativeTools(true).includes("Bash"));
});

test("permission rules: absolute //path, Windows drive form, secrets/config denied, no network or package Bash", () => {
  assert.equal(rulePath("/a/b/"), "//a/b");
  assert.equal(rulePath("C:\\Users\\A\\ws"), "//c/Users/A/ws");
  const p = wsPermissions(D);
  assert.ok(p.allow.includes(`Edit(/${D}/**)`) && p.allow.includes(`Read(/${D}/**)`));
  assert.ok(p.deny.includes(`Read(/${D}/**/.env*)`) && p.deny.includes(`Edit(/${D}/.claude/**)`));
  for (const b of ["Bash(curl *)", "Bash(npm *)", "Bash(npx *)", "WebFetch"]) assert.ok(p.deny.includes(b), b);
  assert.ok(!p.allow.some((r) => /Bash\((?:npm|npx|node \*)/.test(r)));
});

test("preCheck: inside the folder is allowed; every escape is refused", () => {
  const ok = (tool: string, input: Record<string, unknown>) => preCheck(D, tool, input, false);
  assert.equal(ok("Read", { file_path: `${D}/index.html` }), null);
  assert.equal(ok("Edit", { file_path: "css/style.css" }), null);
  assert.equal(ok("Glob", { pattern: "**/*.html" }), null);
  assert.equal(ok("Grep", { pattern: "\\.\\./x", path: D }), null); // a regex, not a path
  assert.equal(ok("Bash", { command: "node --check js/app.js" }), null);
  assert.equal(ok("Skill", { skill: "orbit:site-building" }), null);
  // escapes
  assert.match(ok("Read", { file_path: "/etc/passwd" })!, /inside the workspace/);
  assert.match(ok("Read", { file_path: "../other/index.html" })!, /inside the workspace/);
  assert.match(ok("Write", { file_path: `${D}/../../u2/x/index.html` })!, /inside the workspace/);
  assert.match(ok("Read", { file_path: `${D}-evil/index.html` })!, /inside the workspace/); // prefix sibling
  assert.match(ok("Glob", { pattern: "../**/*" })!, /patterns/);
  assert.match(ok("Glob", { pattern: "/home/**" })!, /patterns/);
  assert.match(ok("Grep", { pattern: "x", path: "/home" })!, /inside the workspace/);
  assert.match(ok("Grep", { pattern: "x", glob: "../*" })!, /patterns/);
  assert.match(ok("Read", { file_path: ".env" })!, /\.env/);
  assert.match(ok("Read", { file_path: "server/.env.local" })!, /\.env/);
  assert.match(ok("Write", { file_path: ".claude/settings.json" })!, /configuration/);
  assert.match(ok("Write", { file_path: "CLAUDE.md" })!, /configuration/);
  assert.match(ok("Edit", { file_path: "sub/AGENTS.md" })!, /configuration/);
  assert.equal(ok("Read", { file_path: "CLAUDE.md" }), null); // reading is fine
  for (const command of ["npm install left-pad", "npx vercel deploy", "node -e \"fetch('http://x')\"", "node server.mjs", "curl http://x", "node --check ../../x.js", "node --check a.js && rm -rf /", "node --check -e x"])
    assert.ok(ok("Bash", { command }), command);
  assert.match(ok("Bash", { command: "node --check ../../x.js" })!, /outside/);
  assert.match(ok("WebFetch", { url: "http://x" })!, /not available/);
  assert.match(ok("Skill", { skill: "run" })!, /orbit/);
  // symlink: the real path decides
  assert.match(preCheck(D, "Read", { file_path: "link/secret" }, false, (p) => p.replace(`${D}/link`, "/home/andreas"), path.posix)!, /inside the workspace/);
  // taint: reads stay, writes and Bash stop
  assert.equal(preCheck(D, "Read", { file_path: "index.html" }, true), null);
  assert.match(preCheck(D, "Edit", { file_path: "index.html" }, true)!, /user's own request/);
  assert.match(preCheck(D, "Bash", { command: "node --check a.js" }, true)!, /user's own request/);
  // no workspace this turn: no file tools at all
  assert.match(preCheck(null, "Read", { file_path: "/tmp/x" }, false)!, /no workspace/);
  assert.equal(preCheck(null, "mcp__orbit__ws_write", {}, false), null);
  // Windows paths
  const W = "C:\\orbit\\ws\\bakery";
  assert.equal(preCheck(W, "Edit", { file_path: "C:\\orbit\\ws\\bakery\\index.html" }, false, undefined, path.win32), null);
  assert.match(preCheck(W, "Edit", { file_path: "C:\\Windows\\win.ini" }, false, undefined, path.win32)!, /inside/);
  assert.match(preCheck(W, "Edit", { file_path: "D:\\bakery\\index.html" }, false, undefined, path.win32)!, /inside/);
  assert.deepEqual(hookOut(null), {});
  assert.equal(hookOut("no").hookSpecificOutput?.permissionDecision, "deny");
  assert.equal(editedPath(D, "Edit", { file_path: `${D}/css/a.css` }), "css/a.css");
  assert.equal(editedPath(D, "Read", { file_path: `${D}/css/a.css` }), null);
});

test("tool search: names only is a fraction of the full tool list", () => {
  const names = Object.keys(TIERS);
  const full = loadedTokens(mcpToolList(names, toolDocs(SITE_PIPELINE, names)));
  const lazy = deferredTokens(names);
  assert.ok(lazy * 2 < full, `${lazy} vs ${full}`);
});

test("skills: each SKILL.md parses, carries the moved text, and the mcp prompt no longer does", () => {
  const dir = path.join(import.meta.dirname, "..", "skills", "orbit", "skills");
  const files = readdirSync(dir);
  assert.deepEqual(files.sort(), SKILLS.map((s) => s.name).sort());
  for (const s of SKILLS) {
    const md = parseSkill(readFileSync(path.join(dir, s.name, "SKILL.md"), "utf8"));
    assert.ok(md, s.name);
    assert.equal(md.name, s.name);
    assert.equal(md.description, s.description);
    for (const m of s.moved) { assert.ok(m.length > 100, "moved text found in its source"); assert.ok(md.body.includes(m.trim()), `${s.name} SKILL.md is out of date with its source text`); }
  }
  JSON.parse(readFileSync(path.join(dir, "..", ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(parseSkill("no frontmatter"), null);
  const prompt = `rules\n${FOLLOW_THROUGH}\n- WORKSPACE ...\n${SITE_PIPELINE}\n\n${leadCheckHint("find 5 bakeries with no website and add them as leads")}USER: hi`;
  assert.ok(prompt.includes("PLAN HINT"));
  const out = stripSkills(prompt);
  assert.ok(!out.includes(SITE_PIPELINE.trim()) && !out.includes(LEAD_RULE) && !out.includes("PLAN HINT"));
  assert.match(out, /orbit:site-building/);
  assert.match(out, /orbit:lead-hunting/);
  assert.ok(out.length < prompt.length - 3000);
  assert.match(SKILLS_NOTE, /orbit:site-building/);
});

test("model routing: builds and planning on Opus high, routine on Sonnet, chit-chat on Haiku; Profile pins; limits step down", () => {
  const models = { fast: "haiku", smart: "sonnet", deep: "opus" };
  const r = (question: string, tier: "fast" | "smart" | "deep", build = false, pref = parsePref("auto")) => routeTurn({ question, tier, pref, build, models });
  assert.deepEqual([r("fix the header", "smart", true).model, r("fix the header", "smart", true).effort], ["opus", "high"]);
  assert.equal(r("make a plan for my channel launch next month", "smart").model, "opus");
  assert.equal(r("add 3 leads from my notes", "smart").model, "sonnet");
  assert.equal(r("thanks!", "fast").model, "haiku");
  assert.equal(r("thanks!", "fast", false, parsePref("opus")).model, "opus");
  assert.equal(r("fix the header", "smart", true, parsePref("sonnet")).model, "sonnet");
  assert.equal(parsePref("gpt"), "auto");
  const deep = r("x", "deep");
  const s = downTier(deep, models)!, h = downTier(s, models)!;
  assert.deepEqual([s.model, h.model, downTier(h, models)], ["sonnet", "haiku", null]);
  assert.ok(isLimitError(new Error("Claude AI usage limit reached|1700000000")));
  assert.ok(!isLimitError(new Error("spawn ENOENT")));
});

test("stable prefix: two turns with different day, profile and memories share the whole static system prompt", () => {
  const sys = (day: string, who: string) => `You are CORE. Today is ${day}; the exact local time is in each request's NOW line.\n\nRules:\n- a\n- b\n\nUser profile (stated by the user):\nName: ${who}\n\n<default_to_action>do</default_to_action>`;
  const a = stableSystem(sys("2026-11-01", "Andreas"), [SKILLS_NOTE]), b = stableSystem(sys("2026-11-02", "A."), [SKILLS_NOTE]);
  const turnA = `${a}\n\nNOW: 09:00\n\nMEMORIES:\n<memory id="1">bakery</memory>`, turnB = `${b}\n\nNOW: 17:30\n\nMEMORIES:\n<memory id="2">clips</memory>`;
  const n = sharedPrefix(turnA, turnB);
  assert.ok(turnA.slice(0, n).includes("<default_to_action>") && turnA.slice(0, n).includes(SKILLS_NOTE), "static rules + notes are all in the shared prefix");
  assert.ok(n >= a.indexOf("Today is") && a.indexOf("Today is") > a.indexOf(SKILLS_NOTE), "only the day/profile tail differs");
  assert.ok(a.endsWith("Name: Andreas"));
});

test("modelForJob: guide table, owner pref wins, risky jobs never below Opus", async () => {
  const { modelForJob, reviewerFor, riskFlags, JOB_MODELS } = await import("../src/lib/core-mcp-boost-pure.ts");
  assert.deepEqual(["search", "build", "ui", "plan"].map((j) => modelForJob(j as never)), ["haiku", "sonnet", "opus", JOB_MODELS.fable]);
  assert.equal(modelForJob("build", {}, "opus"), "opus"); // owner pref wins
  const risky = riskFlags("send the invoice email after login");
  assert.deepEqual(risky, { auth: true, money: true, sending: true });
  for (const pref of [undefined, "haiku", "claude-haiku-5-5", "sonnet", "x"]) assert.equal(modelForJob("search", risky, pref), JOB_MODELS.opus);
  assert.equal(modelForJob("rename", { approvals: true }), "opus");
  assert.equal(modelForJob("security", risky, "fable"), "fable"); // above the floor stays
  // reviewer: Opus, Fable only when Opus wrote it; never below Opus, never the writer
  assert.deepEqual([reviewerFor("sonnet"), reviewerFor("haiku"), reviewerFor("opus"), reviewerFor("claude-opus-5-5"), reviewerFor(JOB_MODELS.fable)], ["opus", "opus", JOB_MODELS.fable, JOB_MODELS.fable, "opus"]);
  assert.equal(modelForJob("build", risky, "opusplan"), "opus"); // opusplan runs on Sonnet: not above the floor
});

test("riskFlags/turnRisk: ordinary phrasings, Estonian, tool names, confirmations of a risky proposal", async () => {
  const { riskFlags, turnRisk, isRisky } = await import("../src/lib/core-mcp-boost-pure.ts");
  for (const q of ["sign in to my bank and transfer 500 EUR to Mari", "reply to Jaan and tell him the deal is off", "wire the deposit", "DM her the link",
    "charge the card", "maksa arve ära", "logi sisse", "gmail_send", "lead_email", "ws_publish", "tweet this", "rotate the API key", "I paid already, mark the bill settled"])
    assert.ok(isRisky(riskFlags(q)), q);
  assert.equal(isRisky(riskFlags("what's the weather")), false);
  assert.equal(isRisky(turnRisk("yes, go ahead", "Shall I send the invoice to Mari?")), true);
  assert.equal(isRisky(turnRisk("yes, go ahead", "", true)), true); // a pending approval
  assert.equal(isRisky(turnRisk("yes, go ahead", "Want me to summarise the article?")), false);
});

test("routeTurn: risky questions get the Opus floor and no limit fallback", () => {
  const models = { fast: "haiku", smart: "sonnet", deep: "opus" };
  for (const pref of ["auto", "sonnet"] as const) {
    const r = routeTurn({ question: "approve and send that payment", tier: "fast", pref, build: false, models });
    assert.equal(r.model, "opus");
    assert.equal(downTier(r, models), null);
  }
  const always = routeTurn({ question: "send the invoice", tier: "fast", pref: "opus", build: false, models });
  assert.equal(always.risky, true); // "always Opus" keeps the floor through a usage limit
  assert.equal(downTier(always, models), null);
  assert.equal(routeTurn({ question: "send it", tier: "fast", pref: "auto", build: false, models: { ...models, deep: "sonnet" } }).model, "opus"); // ORBIT_MODEL_DEEP below Opus
  assert.equal(routeTurn({ question: "yes", tier: "fast", pref: "sonnet", build: false, models, risky: true }).model, "opus");
});
