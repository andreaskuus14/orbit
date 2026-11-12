// Parity of three hand-kept safety tables (night ticket N4). agents.ts, core-modules.ts and AGENTS.md can't load under
// node --test, so they are read as text; each check is also run against a planted mismatch so it can't pass vacuously.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide, PRIVATE_TOOLS, TIERS } from "../src/lib/policy-pure.ts";
import { LIFE_TOOLS } from "../src/lib/core-life.ts";
import { WS_TOOLS } from "../src/lib/core-workspace.ts";
import { OPS_TOOLS } from "../src/lib/core-operator-pure.ts";
import { STUDIO_TOOLS } from "../src/lib/core-studio.ts";
import { AREA_INFO, AREAS, UNDO_MS, quietAuto } from "../src/lib/autonomy-pure.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const AGENTS_TS = read("src/lib/agents.ts"), MODULES_TS = read("src/lib/core-modules.ts"), RULES_MD = read("AGENTS.md");

// ---- (a) agent tools with approval: true <-> decide() T2/T3 ----
/** agent tool name -> approval flag, from the `export const TOOLS = {` block of agents.ts */
function agentApprovals(src: string): Record<string, boolean> {
  const start = src.indexOf("export const TOOLS: Record<string, Tool> = {");
  assert.ok(start >= 0, "agents.ts TOOLS block not found");
  const body = src.slice(start, src.indexOf("\n};", start));
  const out: Record<string, boolean> = {};
  const heads = [...body.matchAll(/^ {2}([a-z_]+): \{/gm)];
  heads.forEach((h, i) => { out[h[1]] = /^\s+approval: true,/m.test(body.slice(h.index, heads[i + 1]?.index)); });
  return out;
}
const ctx = { stopAll: false, attach: false, pins: false, steps: [], question: "" };
const tierOf = (tool: string) => decide(tool, {}, ctx).tier;
/** mismatches: an approval tool decide() treats as T0/T1, or a no-approval tool CORE knows that decide() treats as T2/T3 */
function approvalMismatches(flags: Record<string, boolean>): string[] {
  return Object.entries(flags).flatMap(([t, approval]) => {
    const high = tierOf(t) === "T2" || tierOf(t) === "T3";
    if (approval && !high) return [`${t}: approval but ${tierOf(t)}`];
    if (!approval && t in TIERS && high) return [`${t}: no approval but ${tierOf(t)}`]; // tools decide() doesn't know fail closed as T3: not a CORE tier claim
    return [];
  });
}

test("(a) every agent tool with approval: true is T2/T3 in decide(), and no CORE-known one without it is", () => {
  const flags = agentApprovals(AGENTS_TS);
  assert.ok(Object.keys(flags).length >= 15 && flags.save_memory && flags.save_lead && flags.fetch_url === false, "parser sees the table");
  assert.deepEqual(approvalMismatches(flags), []);
});
test("(a) planted mismatch fails", () => {
  assert.notDeepEqual(approvalMismatches({ ...agentApprovals(AGENTS_TS), web_search: true }), []);
  assert.notDeepEqual(approvalMismatches({ ...agentApprovals(AGENTS_TS), save_memory: false }), []);
});

// ---- (b) PRIVATE_TOOLS <-> core-modules.ts private flags ----
const SPREADS: Record<string, readonly string[]> = { LIFE_TOOLS, WS_TOOLS, OPS_TOOLS, STUDIO_TOOLS };
const strs = (list: string) => list.split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => {
  if (s.startsWith("...")) { const l = SPREADS[s.slice(3)]; assert.ok(l, `unknown spread ${s}`); return [...l]; }
  const m = s.match(/^"([a-z0-9_]+)"$/); assert.ok(m, `unparsed tool entry ${s}`); return [m[1]];
});
/** privateTools(MODULES) computed from the source text: private: true -> all its tools, private: [...] -> those. */
function modulePrivate(src: string): string[] {
  return src.split(/\n(?=\s+name: ")/).flatMap((chunk) => {
    const line = chunk.split("\n").find((l) => /^\s+name: "/.test(l)) ?? "";
    const tools = line.match(/tools: \[([^\]]*)\]/), priv = line.match(/private: (true|\[([^\]]*)\])/);
    if (!priv) { assert.ok(!/private:/.test(line.replace(/prompt:.*/, "")), `unparsed private flag: ${line.slice(0, 120)}`); return []; }
    assert.ok(tools, `no tools on ${line.slice(0, 80)}`);
    return priv[1] === "true" ? strs(tools[1]) : strs(priv[2]);
  });
}
const sorted = (a: readonly string[]) => [...new Set(a)].sort();

test("(b) policy-pure PRIVATE_TOOLS equals core-modules.ts private flags", () => {
  const mods = modulePrivate(MODULES_TS);
  assert.ok(mods.includes("life_journal") && mods.includes("week_review"), "parser sees the modules");
  assert.deepEqual(sorted(PRIVATE_TOOLS), sorted(mods));
});
test("(b) planted mismatch fails", () => {
  const planted = MODULES_TS.replace('name: "IDEAS", tools: ["ideas_list"],', 'name: "IDEAS", tools: ["ideas_list"], private: true,');
  assert.notEqual(planted, MODULES_TS);
  assert.notDeepEqual(sorted(PRIVATE_TOOLS), sorted(modulePrivate(planted)));
});

// ---- (c) Auto limits <-> AGENTS.md rule 6 ----
type Rule6 = { autoAreas: string[]; cancelMin: number; quiet: [number, number] };
function rule6(md: string): Rule6 {
  const m = md.match(/^6\. [\s\S]*?(?=^\d+\. |(?![\s\S]))/m); assert.ok(m, "AGENTS.md rule 6 not found");
  const r = m[0].replace(/\s+/g, " ");
  const two = r.match(/exactly two things may go out without a click.*?Every other send/); assert.ok(two, "rule 6 Auto sentence not found");
  const cancel = r.match(/(\d+)-minute cancel window/), quiet = r.match(/quiet hours \((\d\d):00-(\d\d):00\)/);
  assert.ok(cancel && quiet, "rule 6 cancel window / quiet hours not found");
  return { autoAreas: [...two[0].matchAll(/`([a-z-]+)`/g)].map((x) => x[1]).sort(), cancelMin: +cancel[1], quiet: [+quiet[1], +quiet[2]] };
}
const at = (h: number, min = 0) => Date.UTC(2026, 0, 15, h - 2, min); // Tallinn is UTC+2 in January
function autoMismatches(r: Rule6): string[] {
  const out: string[] = [];
  const auto = AREAS.filter((a) => AREA_INFO[a].levels.includes("auto")).sort();
  if (JSON.stringify(auto) !== JSON.stringify(r.autoAreas)) out.push(`auto areas ${auto} vs rule 6 ${r.autoAreas}`);
  if (UNDO_MS !== r.cancelMin * 60_000) out.push(`UNDO_MS ${UNDO_MS} vs ${r.cancelMin} min`);
  const [from, to] = r.quiet; // quiet must cover the rule's whole window, and not more (each hour checked at :00 and :59)
  for (let h = 0; h < 24; h++) for (const min of [0, 59]) {
    const want = from > to ? h >= from || h < to : h >= from && h < to;
    if (quietAuto(at(h, min)) !== want) out.push(`quiet at ${h}:${min} is ${!want}`);
  }
  return out;
}

test("(c) Auto areas, cancel window and quiet hours equal AGENTS.md rule 6", () => {
  const r = rule6(RULES_MD);
  assert.deepEqual(r, { autoAreas: ["business-send", "studio-publish"], cancelMin: 10, quiet: [23, 8] }, "parser reads the rule");
  assert.deepEqual(autoMismatches(r), []);
  for (const a of AREAS) assert.notEqual(AREA_INFO[a].def, "auto", a); // rule 6: Auto only when he turns it on
});
test("(c) planted mismatch fails", () => {
  for (const [from, to] of [["10-minute", "15-minute"], ["(23:00-08:00)", "(22:00-08:00)"], ["(23:00-08:00)", "(23:00-07:00)"], ["(`studio-publish`)", "(`higgsfield-spend`)"]]) {
    const planted = RULES_MD.replace(from, to);
    assert.notEqual(planted, RULES_MD, from);
    assert.notDeepEqual(autoMismatches(rule6(planted)), [], from);
  }
});
