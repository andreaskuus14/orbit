// The morning brief's Today section (brief-pure todayGroups) and its two spoken lines (overdue goal, due follow-ups). Synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WORDS, TODAY_ROWS, briefDecisions, composeBrief, todayGroups, type BriefIn, type ProjectTask, type TodayGroup } from "../src/lib/brief-pure.ts";

const now = Date.parse("2026-11-08T07:00:00Z"), day = "2026-11-08";
const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";
const decisions = briefDecisions(
  [{ label: "Publish the bakery post", open: { task: "t1" } }, { label: "Run the roof study", open: { task: "t2" } }],
  [],
  [{ id: "send:p9", kind: "send", title: "Tartu Cafe", to: "hi@tartu.ee" }],
);
const task = (id: string, project_id: string, status: string, finishedHoursAgo: number | null, title = `Task ${id}`): ProjectTask =>
  ({ id, project_id, title, status, finished_at: finishedHoursAgo === null ? null : new Date(now - finishedHoursAgo * 3_600_000).toISOString(), created_at: new Date(now - 48 * 3_600_000).toISOString() });
const base = (over: Partial<BriefIn> = {}, morning: Partial<BriefIn["morning"]> = {}): BriefIn => ({
  day, hour: 8, life: false, snoozed: [], replies: [], decisions,
  morning: {
    calendar: { connected: true, today: [{ time: "09:30", title: "Dentist, private" }, { time: "14:00", title: "Site visit Saaremaa" }] },
    deadlines: [
      { id: "g-over", title: "Submit the planning permit", next: "Sign the forms", days: -2, arch: true },
      { id: "g-today", title: "Send the quote to Mari", days: 0, arch: false },
      { id: "g-tomorrow", title: "Finish the floor plan", days: 1, arch: true },
      { id: "g-later", title: "Order roof samples", days: 5, arch: true },
    ],
    followups: [{ id: "c1", name: "Kalev Bakery" }, { id: "c2", name: "Tartu Cafe" }],
    ...morning,
  },
  projects: {
    names: { [P1]: "House A", [P2]: "Summer house" },
    tasks: [
      task("a1", P1, "done", 2, "Drew the ground floor"), task("a2", P1, "failed", 1, "Price check timed out"), task("a3", P1, "awaiting_approval", null, "Email the builder"),
      task("a-old", P1, "done", 30, "Old work, two days ago"),
      task("b1", P2, "done", 5, "Collected larch prices"),
      task("x1", "33333333-3333-4333-8333-333333333333", "done", 1, "Not one of his projects"),
    ],
  },
  ...over,
});
const groupOf = (gs: TodayGroup[], key: TodayGroup["key"]) => gs.find((g) => g.key === key);

test("decisions: every one waiting is listed with its action; only two are spoken; emails stay open-only", () => {
  const b = composeBrief(base(), now);
  const d = groupOf(b.today!, "decisions")!;
  assert.deepEqual(d.rows.map((r) => r.id), ["decision:task:t1", "decision:task:t2", "decision:send:p9"]);
  assert.deepEqual(d.rows[0].approve, { task: "t1" });
  assert.equal(d.rows[2].approve, undefined, "an email is never one-tap approved, here either");
  assert.deepEqual(d.rows[2].open, { panel: "business" });
  assert.equal(b.items.filter((i) => i.kind === "decision").length, 2);
  // A snoozed decision leaves the card's list too.
  assert.deepEqual(groupOf(todayGroups(base({ snoozed: ["decision:task:t2"] }), now), "decisions")!.rows.map((r) => r.id), ["decision:task:t1", "decision:send:p9"]);
});

test("deadlines: overdue, today and tomorrow listed (overdue first and flagged), later counted, follow-ups open the exact client", () => {
  const d = groupOf(todayGroups(base(), now), "deadlines")!;
  assert.deepEqual(d.rows.map((r) => r.id), ["deadline:g-over", "deadline:g-today", "deadline:g-tomorrow", "followup:c1", "followup:c2", "deadline:later"]);
  assert.equal(d.rows[0].detail, "2 days overdue · next: Sign the forms");
  assert.equal(d.rows[0].urgent, true); assert.equal(d.rows[1].urgent, true); assert.equal(d.rows[2].urgent, undefined);
  assert.equal(d.rows[2].detail, "Due tomorrow");
  assert.deepEqual(d.rows[0].open, { goal: "g-over" });
  assert.deepEqual(d.rows[3].open, { link: "#o=business&v=client&k=client&id=c1" });
  assert.equal(d.rows[3].approve, undefined, "a follow-up opens BUSINESS, where he approves the message");
  assert.equal(d.rows[5].title, "1 more goal due later this week");
});

test("spoken: the most urgent goal deadline follows the decisions; due follow-ups get one line; still about a minute", () => {
  const b = composeBrief(base(), now);
  assert.deepEqual(b.items.slice(0, 3).map((i) => i.id), ["decision:task:t1", "decision:task:t2", "deadline:g-over"]);
  assert.match(b.spoken, /Submit the planning permit is two days overdue\./);
  const one = composeBrief(base({ decisions: [] }, { deadlines: [{ id: "g", title: "Send the quote", days: 0, arch: false }], followups: [{ id: "c1", name: "Kalev Bakery" }] }), now);
  assert.match(one.spoken, /Send the quote is due today\./);
  assert.match(one.spoken, /Kalev Bakery hasn't replied in a while, a follow-up is due\./);
  assert.deepEqual(one.items.find((i) => i.id === `followups:${day}`)?.open, { link: "#o=business&v=client&k=client&id=c1" });
  assert.ok(b.spoken.split(/\s+/).length <= MAX_WORDS);
  // Nothing due today: nothing said about deadlines.
  const calm = composeBrief(base({}, { deadlines: [{ id: "g", title: "Later", days: 3, arch: false }], followups: [] }), now);
  assert.doesNotMatch(calm.spoken, /overdue|due today|follow-up/);
});

test("a source that couldn't be read says so instead of looking empty", () => {
  const both = groupOf(todayGroups(base({}, { deadlines: null, followups: null }), now), "deadlines")!;
  assert.deepEqual(both.rows, []);
  assert.match(both.failed!, /unknown, not zero/);
  const one = groupOf(todayGroups(base({}, { followups: null }), now), "deadlines")!;
  assert.ok(one.rows.some((r) => r.id === "followup:failed" && /couldn't be read/.test(r.title)));
  assert.ok(one.rows.some((r) => r.id === "deadline:g-over"));
  assert.match(groupOf(todayGroups(base({ projects: null }), now), "projects")!.failed!, /couldn't be read/);
  assert.match(groupOf(todayGroups(base({}, { calendar: { connected: false, today: [] } }), now), "calendar")!.failed!, /couldn't be read/);
  // Not gathered at all (no Google calendar configured, no project data passed): no group, rather than a false "nothing".
  const none = todayGroups(base({ projects: undefined }, { calendar: undefined }), now);
  assert.equal(groupOf(none, "calendar"), undefined); assert.equal(groupOf(none, "projects"), undefined);
});

test("calendar: every event today; titles only with his LIFE opt-in, never by default", () => {
  const off = groupOf(todayGroups(base(), now), "calendar")!;
  assert.deepEqual(off.rows.map((r) => [r.title, r.detail]), [["Calendar event", "09:30"], ["Calendar event", "14:00"]]);
  assert.doesNotMatch(JSON.stringify(composeBrief(base(), now).today), /Dentist|Saaremaa/);
  const on = groupOf(todayGroups(base({ life: true }), now), "calendar")!;
  assert.deepEqual(on.rows.map((r) => r.title), ["Dentist, private", "Site visit Saaremaa"]);
});

test("projects: what moved in the last day per project, newest first, failures flagged, linked to the newest changed task", () => {
  const p = groupOf(todayGroups(base(), now), "projects")!;
  assert.deepEqual(p.rows.map((r) => r.title), ["House A", "Summer house"]);
  assert.equal(p.rows[0].detail, "1 done · 1 failed · 1 waiting for your OK · latest: Price check timed out");
  assert.equal(p.rows[0].urgent, true);
  assert.deepEqual(p.rows[0].open, { link: "#o=operations&k=task&id=a2" });
  assert.equal(p.rows[1].detail, "1 done · latest: Collected larch prices");
  assert.doesNotMatch(JSON.stringify(p), /Old work|Not one of his/);
});

test("long lists are capped per group and counted", () => {
  const many = Array.from({ length: TODAY_ROWS + 3 }, (_, k) => ({ id: `c${k}`, name: `Client ${k}` }));
  const d = groupOf(todayGroups(base({}, { deadlines: [], followups: many }), now), "deadlines")!;
  assert.equal(d.rows.length, TODAY_ROWS);
  assert.equal(d.more, 3);
});

test("the brief overlay renders Today with labelled Approve/Open per row and the unreadable notice", async () => {
  const { readFileSync } = await import("node:fs"), { createRequire } = await import("node:module"), { runInNewContext } = await import("node:vm");
  const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server"), ts = (await import("typescript")).default;
  const { translate } = await import("../src/lib/i18n-pure.ts");
  const req = createRequire(import.meta.url);
  const code = ts.transpileModule(readFileSync(new URL("../src/components/MorningBriefBody.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const brief = { ...composeBrief(base({ projects: null }), now), life: false };
  const state: unknown[] = [brief, "", false, false, {}]; // b, err, planning, muted, marks
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, require: (name: string) => {
    if (name === "react") return { ...req("react"), useState: () => [state.shift(), () => {}], useEffect: () => {} };
    if (name === "react/jsx-runtime") return req(name);
    if (name === "@/lib/brief-pure") return {};
    if (name === "./i18n") return { useT: () => ({ t: (k: any, p: any) => translate("en", k, p), lang: "en" }) };
    if (name === "@/lib/i18n-pure") return { greetKey: () => "greet.morning" };
    if (name.endsWith("/speak")) return { speakChunk() {}, speechSettings: () => ({ speak: false }), stop() {} };
    if (name.endsWith("/AgentMission")) return { api: async () => ({}) };
    if (name.endsWith("/DayPlan")) return { DayPlan: () => null };
    if (name.endsWith("/NeedsYou")) return { openTarget() {} };
    if (name.endsWith("/announce")) return { announce() {} };
    throw new Error(name);
  } });
  const html = renderToStaticMarkup(createElement(m.exports.default, { home: true, onOpenTask() {}, onOpenGoal() {}, onClose() {} }));
  for (const label of ["Decisions waiting for you", "Deadlines", "Calendar today", "Project changes"]) assert.ok(html.includes(label), label);
  assert.match(html, /aria-label="Approve: Publish the bakery post"/);
  assert.match(html, /aria-label="Open: Follow up: Kalev Bakery"/);
  assert.doesNotMatch(html, /aria-label="Approve: Tartu Cafe"/, "no one-tap approve for an email");
  assert.match(html, /Project tasks couldn&#x27;t be read\./);
  assert.doesNotMatch(html, /Dentist/, "calendar titles stay hidden without the LIFE opt-in");
});
