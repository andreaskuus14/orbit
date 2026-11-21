import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUARD_TAG, SQUAD, auditRemotes, currencyFlow, curves, economyMap, exploitSigns, guardProposals, hashText, heatGrid, heatmapSvg, parseTelemetry, playBugs,
  proposalDiff, runSquad, seenIn, squadProgress, stages, telemetryPrompt, type Deps, type Run,
} from "../src/lib/playtesters-pure.ts";
import { createToolTap, playtestPrompt, createToolGuard, PLAYTEST_TOOLS } from "../src/lib/roblox-pure.ts";
import { NIGHT_DEFAULTS, planNight } from "../src/lib/night-pure.ts";

// ---- A mocked Roblox Studio MCP: stream-json lines as the claude CLI prints them -----------------------------
let n = 0;
const use = (tool: string, input: Record<string, unknown> = {}) => { const id = `tu_${++n}`; return { id, line: JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: `mcp__roblox__${tool}`, input }] } }) }; };
const result = (id: string, text: string) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });
/** One fake playtest session: inspect_instance replies with leaderstats values; returns the raw text ORBIT's tap collects. */
function mockSession(values: number[]): string {
  const tap = createToolTap(["inspect_instance"]);
  for (const v of values) { const u = use("inspect_instance", { path: "Players.Tester.leaderstats.Coins" }); tap.line(u.line); tap.line(result(u.id, `{"ClassName":"IntValue","Name":"Coins","Value":${v}}`)); }
  const other = use("get_console_output"); tap.line(other.line); tap.line(result(other.id, "Value: 999999")); // not inspect: must not count
  return tap.text();
}
const final = (o: unknown) => `Played.\n${JSON.stringify(o)}`;
const sample = (step: number, x: number, z: number, coins: number, zone = "") => ({ step, x, z, zone, stats: { Coins: coins } });

test("squad: the six asked-for testers, goals fit the bridge's 200-char limit", () => {
  assert.deepEqual(SQUAD.map((t) => t.id), ["grinder", "casual", "spender", "explorer", "bughunter", "new"]);
  for (const t of SQUAD) assert.ok(t.goal.length <= 200, t.id);
});

test("prompt: telemetry is added to the bridge's own look-only prompt, tools unchanged", () => {
  const p = playtestPrompt("goal", telemetryPrompt());
  assert.match(p, /TELEMETRY/);
  assert.match(p, /never change anything/);
  assert.equal(playtestPrompt("goal"), playtestPrompt("goal", "")); // default prompt unchanged
  assert.ok(!PLAYTEST_TOOLS.includes("execute_luau") && !PLAYTEST_TOOLS.includes("user_mouse_input"));
  const g = createToolGuard("playtest");
  g.init(PLAYTEST_TOOLS.map((t) => `mcp__roblox__${t}`));
  assert.match(String(g.use("mcp__roblox__execute_luau", {})), /Refused/);
});

test("telemetry: numbers count only when the mocked MCP really returned them", () => {
  const raw = mockSession([0, 40, 95]);
  const t = parseTelemetry(final({ done: true, findings: [], samples: [sample(0, 0, 0, 0), sample(1, 20, 0, 40), sample(2, 40, 5, 95), sample(3, 60, 5, 999999)], steps: ["Walk to CoinPad", "Walk to Egg", "Walk to Shop"] }), raw);
  assert.deepEqual(t.samples.map((s) => s.verified), [true, true, true, false]);
  assert.equal(t.steps.length, 3);
  assert.ok(seenIn("Value: 1,234,567", 1234567) && !seenIn("Value: 12345", 1234) && seenIn("x -5 y", -5));
});

test("telemetry: junk is dropped; standing still after a walk counts as stuck", () => {
  const t = parseTelemetry(final({ samples: [{ step: "a" }, sample(0, 1, 1, 0), sample(1, 1.5, 1, 0), { step: 2, stats: { "bad;name": 3 } }], stuck: [{ what: "" }], items: ["a", 7] }), "0");
  assert.equal(t.samples.length, 3);
  assert.equal(t.stuck.length, 1);
  assert.match(t.stuck[0].what, /Didn't move/);
  assert.deepEqual(t.items, ["a"]);
});

const run = (tester: string, s: ReturnType<typeof sample>[], o: Partial<Run> = {}): Run => ({ tester, done: true, findings: [], consoleErrors: [], notes: "",
  tel: { samples: s.map((x) => ({ ...x, verified: true })), stuck: [], items: [], steps: s.slice(1).map((_, i) => `Walk ${i + 1}`) }, ...o });

test("economy: coins in vs out and the curve use verified samples only", () => {
  const r = run("grinder", [sample(0, 0, 0, 0), sample(1, 1, 0, 50), sample(2, 2, 0, 20), sample(3, 3, 0, 70)]);
  r.tel.samples.push({ step: 4, x: 0, z: 0, zone: "", stats: { Coins: 1e9 }, verified: false });
  const [f] = currencyFlow([r]);
  assert.deepEqual([f.currency, f.earned, f.spent], ["Coins", 100, 30]);
  assert.deepEqual(curves([r])[0].points.map((p) => p.value), [0, 50, 20, 70]);
});

test("exploit signs: negative balance, impossible jump, duplicate pet ids, with repro steps", () => {
  const r = run("bughunter", [sample(0, 0, 0, 10), sample(1, 1, 0, -5), sample(2, 2, 0, 900_000)]);
  r.tel.items = ["pet-1", "pet-2", "pet-1"];
  const bugs = exploitSigns([r], "PetSim.rbxl");
  assert.deepEqual(bugs.map((b) => b.id.split(":")[0]).sort(), ["dupe", "jump", "neg"]);
  const neg = bugs.find((b) => b.id.startsWith("neg"))!;
  assert.equal(neg.repro[0], "Open PetSim.rbxl in Roblox Studio and press Play.");
  assert.ok(neg.repro.includes("Walk 1."));
});

const SERVER = [
  'local RS = game:GetService("ReplicatedStorage")',
  'local Remotes = RS:WaitForChild("Remotes")',
  'Remotes:WaitForChild("AddCoins").OnServerEvent:Connect(function(player, amount)',
  '\tlocal ls = player:FindFirstChild("leaderstats")',
  '\tls.Coins.Value += amount',
  'end)',
  'Remotes.BuyEgg.OnServerEvent:Connect(function(player, cost)',
  '\tif typeof(cost) ~= "number" or cost < 0 then',
  '\t\treturn',
  '\tend',
  '\tplayer.leaderstats.Coins.Value -= cost',
  'end)',
  'local function onSell(player, price)',
  '\tplayer.leaderstats.Coins.Value = player.leaderstats.Coins.Value + price',
  'end',
  'Remotes.Sell.OnServerEvent:Connect(onSell)',
].join("\n");
const STATS = 'game.Players.PlayerAdded:Connect(function(p)\n\tlocal ls = Instance.new("Folder")\n\tls.Name = "leaderstats"\n\tlocal c = Instance.new("IntValue")\n\tc.Name = "Coins"\n\tc.Parent = ls\nend)';
const FILES = [{ file: "src/ServerScriptService/Shop.server.luau", text: SERVER }, { file: "src/ServerScriptService/Stats.server.luau", text: STATS }];

test("remotes: unchecked client values reaching .Value are flagged; checked ones are not", () => {
  const rs = auditRemotes(FILES);
  assert.deepEqual(rs.map((r) => `${r.remote}:${r.param}`), ["AddCoins:amount", "Sell:price"]);
  assert.equal(rs[0].line, 3);
  assert.equal(rs[1].line, 13); // the named handler's own line
});

test("economy map: where Coins are earned and spent in the code", () => {
  const [m] = economyMap(FILES);
  assert.equal(m.currency, "Coins");
  assert.deepEqual(m.earn.map((s) => s.line), [5, 14]);
  assert.deepEqual(m.spend.map((s) => s.line), [11]);
});

test("proposals: a guard line per flagged handler, made against the exact file text", () => {
  const [p] = guardProposals(FILES, auditRemotes(FILES));
  assert.equal(p.status, "pending");
  assert.equal(p.hash, hashText(SERVER));
  const lines = p.after.split("\n");
  assert.equal(lines[3], '\tif typeof(amount) ~= "number" or amount ~= amount or amount < 0 or amount > 1000000 then');
  assert.ok(lines[4].includes(GUARD_TAG));
  assert.equal(proposalDiff(p).length, 6); // 3 lines × 2 handlers
  assert.equal(auditRemotes([{ file: FILES[0].file, text: p.after }]).length, 0); // the fix silences the finding
});

test("heatmap: visits, stuck and stopped cells; SVG escapes zone names", () => {
  const a = run("explorer", [sample(0, 0, 0, 0, "Spawn"), sample(1, 100, 100, 0, "<Gate>")], { done: false });
  a.tel.stuck = [{ step: 1, x: 100, z: 100, what: "Walk to gate failed" }];
  const h = heatGrid([a])!;
  assert.equal(h.cells.reduce((s, c) => s + c.visits, 0), 2);
  assert.equal(h.cells.reduce((s, c) => s + c.stuck, 0), 1);
  assert.equal(h.cells.reduce((s, c) => s + c.quit, 0), 1);
  const svg = heatmapSvg(h, "t");
  assert.ok(svg.startsWith("<svg") && svg.includes("&#60;Gate&#62;") && !svg.includes("<Gate>"));
  assert.equal(heatGrid([]), null);
});

test("play bugs: console errors merge across testers with each repro", () => {
  const e = "ServerScriptService.Eggs:12: attempt to index nil";
  const bugs = playBugs([run("grinder", [sample(0, 0, 0, 0)], { consoleErrors: [e] }), run("new", [sample(0, 0, 0, 0)], { consoleErrors: [e] })], "P");
  assert.equal(bugs.length, 1);
  assert.deepEqual(bugs[0].who, ["grinder", "new"]);
  assert.match(bugs[0].repro.at(-1)!, /Output/);
});

function deps(o: Partial<Deps> = {}): Deps & { played: string[]; steps: number[] } {
  const played: string[] = [], steps: number[] = [];
  return {
    played, steps,
    status: async () => ({ configured: true, open: true, place: "PetSim", notes: "" }),
    play: async (goal) => {
      played.push(goal);
      return { done: true, findings: [], consoleErrors: [], notes: "", inspect: mockSession([0, 30]), text: final({ done: true, findings: [], samples: [sample(0, 0, 0, 0, "Spawn"), sample(1, 30, 0, 30)], steps: ["Walk to CoinPad"] }) };
    },
    code: async () => ({ project: "PetSim", files: FILES }),
    onStep: (i) => steps.push(i),
    now: () => "2026-11-21T03:00:00.000Z",
    ...o,
  };
}

test("runSquad (mocked MCP): six runs, code check, report with card, heatmap, bugs and fixes", async () => {
  const d = deps();
  const r = await runSquad(d);
  assert.equal(d.played.length, 6);
  assert.deepEqual(d.steps, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(r.runs.length, 6);
  assert.equal(r.flow[0].earned, 180);
  assert.ok(r.heatSvg?.startsWith("<svg"));
  assert.equal(r.proposals.length, 1);
  assert.ok(r.bugs.some((b) => b.kind === "code"));
  assert.match(r.line, /6 of 6 played/);
  const card = squadProgress({ running: false, step: 0, now: "", startedAt: null }, r, "en", Date.parse(r.at))!;
  assert.equal(card.phase, "needs");
  assert.equal(card.action?.kind, "approve"); // opens the fixes; never applies by itself
  const live = squadProgress({ running: true, step: 2, now: "Cass is playing", startedAt: r.at }, null, "en", Date.parse(r.at) + 60_000)!;
  assert.equal(live.phase, "working");
  assert.equal(live.steps.length, stages().length);
});

test("runSquad: Studio closed or bridge missing → no play at all, code still checked, said plainly", async () => {
  const d = deps({ status: async () => ({ configured: true, open: false, place: "", notes: "no Studio" }) });
  const r = await runSquad(d);
  assert.equal(d.played.length, 0);
  assert.match(r.studio, /Studio wasn't open/);
  assert.ok(r.untested.some((u) => u.startsWith("No Studio runs")));
  const d2 = deps({ status: async () => ({ configured: false, open: false, place: "", notes: "" }), code: async () => null });
  const r2 = await runSquad(d2);
  assert.equal(d2.played.length, 0);
  assert.ok(r2.untested.some((u) => /No Rojo project/.test(u)));
});

test("runSquad: a failing run is kept as not done; abort stops the next ones", async () => {
  const ac = new AbortController();
  let k = 0;
  const r = await runSquad(deps({ play: async () => { if (++k === 2) { ac.abort(); throw new Error("Studio busy"); } return { done: true, findings: [], consoleErrors: [], notes: "", inspect: "", text: "{}" }; }, signal: ac.signal }));
  assert.equal(r.runs.length, 2);
  assert.equal(r.runs[1].done, false);
  assert.equal(r.runs[1].error, "Studio busy");
});

test("night: playtesters only planned when due (owner switched them on)", () => {
  const base = { tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now: 0, today: "2026-11-21" };
  const has = (q: { kind: string }[]) => q.some((t) => t.kind === "playtesters");
  assert.ok(!has(planNight(base, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue));
  assert.ok(has(planNight({ ...base, playtesters: true }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue));
  assert.ok(!has(planNight({ ...base, playtesters: true, off: ["playtesters"] }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue));
});
