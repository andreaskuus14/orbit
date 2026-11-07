import { test } from "node:test";
import assert from "node:assert/strict";
import { blockerOf, entries, linkOf, nextOf, proofOf, sectionOf, summaryOf, teamBoard, type Section } from "../src/lib/team-status-pure.ts";
import { SAMPLE_BOARD } from "../src/lib/team-status-sample.ts";
import { forgetBoard, pageId, readBoard } from "../src/lib/team-status.ts";

const where = (b: ReturnType<typeof teamBoard>) => Object.fromEntries(Object.entries(b).flatMap(([s, items]) => items.map((i) => [`${i.agent}:${i.pr ?? "-"}`, s])));

test("the sample board: what shipped, who's blocked and what needs the owner, one item per agent and PR", () => {
  const b = teamBoard(SAMPLE_BOARD, "andreaskuus14/orbit");
  assert.deepEqual(where(b), {
    "6:423": "done", "4:427": "done", "1:424": "done", // shipped / verified, someone else acts next
    "3:-": "working", // latest: claiming the Windows Stop follow-up (earlier no-PR updates folded in)
    "C:-": "blocked", "9:426": "blocked", // "Blocker: …" / "Blocked: …"
    "8:426": "needs", "7:426": "needs", "2:428": "needs", "3:425": "needs", // next: Andreas decides / merge decision / assign
  } satisfies Record<string, Section>);
  const by = (k: string) => Object.values(b).flat().find((i) => `${i.agent}:${i.pr ?? "-"}` === k)!;
  assert.equal(by("6:423").proof, "merged");
  assert.equal(by("1:424").proof, "merged", '"in main 02b6c8f"');
  assert.equal(by("7:426").proof, "passed", '"PASS … Nothing merged or deployed" is a passing test, not a merge');
  assert.equal(by("2:428").proof, "passed", '"22 ok / 0 failed" and "unattended releases off" aren\'t a deployment');
  assert.equal(by("8:426").proof, "failed");
  assert.equal(by("8:426").updates, 2, "the earlier no-PR test line folds into Agent 8's latest update");
  assert.equal(by("3:-").updates, 3, "Agent 3's in-progress smoke update and its continuation block fold into the latest");
  assert.equal(by("9:426").blocker, "no GitHub API here, so CI states come from board reports");
  assert.equal(by("7:426").next, "Andreas, merge decision on #426");
  assert.deepEqual(by("4:427").link, { href: "https://github.com/andreaskuus14/orbit/pull/427", label: "#427" });
  assert.equal(by("4:427").summary, "verified: a deleted project's old name-tagged memories stay out of a same-named new project", "skips the bare '#427 (draft)' field");
  assert.deepEqual(Object.values(b).flat().map((i) => i.summary).filter((s) => s.length > 140), []);
  assert.equal(b.needs[0].agent, "8", "newest first");
});

test("negations aren't claims: nothing merged or deployed, no deploy, blockers none", () => {
  for (const t of ["Agent 5 | verified: PASS | Nothing merged or deployed.", "Agent 6 — merges only, no deploy. Gate PASS"]) assert.equal(proofOf(t), "passed", t);
  assert.equal(proofOf("Agent 2 | shipped | Not merged, not deployed; unattended releases off"), null, "no evidence at all");
  assert.equal(proofOf("Agent 6 | shipped: #423 merged; deployed to the PC"), "deployed");
  assert.equal(proofOf("Agent 3 | tests 3324 pass / 1 fail"), "failed");
  assert.equal(proofOf("Agent 3 | 3334 pass / 0 fail / 1 skipped"), "passed");
  assert.equal(sectionOf("Agent 5 | done: review | Blockers: none. Nothing deployed."), "done");
  assert.equal(sectionOf("Agent 5 | review | Blocked: no GitHub API here"), "blocked", '"no GitHub API" is a blocker, not "no blocker"');
  assert.equal(blockerOf("Agent 5 | x | Blocker: none"), "");
});

test("sections: the owner's next step wins, then a blocker, then work in progress, then done", () => {
  assert.equal(sectionOf("Agent 3 | verified | next: Agent 5 reviews, Andreas decides on a PR or merge"), "needs");
  assert.equal(sectionOf("Agent 8 | finding | next: Andreas/Coordinator assign the fix"), "needs");
  assert.equal(sectionOf("Agent 2 | shipped | next: Agent 3 re-runs it"), "done");
  assert.equal(sectionOf("Agent 3 — Status: smoke of main: IN PROGRESS, no result yet."), "working");
  assert.equal(sectionOf("Agent 6 | shipped: #423 merged | next: Agent 3 | now starting: re-review of #427"), "done", "its headline is what shipped");
  assert.equal(sectionOf("Agent 3 | smoke FAIL (1 test) | next: Coordinator, route it"), "blocked");
  assert.equal(nextOf("Agent 7 | PASS | Next: Andreas, merge decision on #426. Nothing merged."), "Andreas, merge decision on #426");
  assert.equal(summaryOf("Agent 3 → Agent 2 — Finished: Windows check of #425. Run 42376123647: success."), "Finished: Windows check of #425");
  assert.equal(summaryOf("Agent 6 | shipped: #423 merged | next: Agent 3 | now starting: re-review of #427"), "shipped: #423 merged");
  assert.equal(summaryOf("Agent 4 | #427 (draft) | next: x | verified: the fix holds"), "verified: the fix holds");
});

test("entries: continuation blocks join the update above; nothing before the first speaker is kept", () => {
  const e = entries([{ text: "Board intro" }, { text: "Agent 3 — Status: smoke", links: ["a"] }, { text: "- step 1 done", links: ["b"] }, { text: "ChatGPT Coordinator — Task: x" }]);
  assert.deepEqual(e.map((x) => [x.agent, x.text, x.links]), [["3", "Agent 3 — Status: smoke - step 1 done", ["a", "b"]], ["C", "ChatGPT Coordinator — Task: x", []]]);
});

test("links: this item's PR link, else one built from the repo, else a test run", () => {
  const pr = "https://github.com/o/r/pull/426", run = "https://github.com/o/r/actions/runs/1";
  assert.deepEqual(linkOf([run, pr], 426), { href: pr, label: "#426" });
  assert.deepEqual(linkOf([run], 427, "o/r"), { href: "https://github.com/o/r/pull/427", label: "#427" });
  assert.deepEqual(linkOf([run, "https://github.com/o/r/pull/9"], 427), { href: run, label: "test run" }, "another PR's link isn't this item's");
  assert.equal(linkOf(["https://evil.example/pull/1"], null), null);
});

test("readBoard: not set up → the reason; the Notion API read with nested blocks and pages; failures → the reason; cached", async () => {
  forgetBoard();
  assert.match((await readBoard({})).live === false ? (await readBoard({}) as { reason: string }).reason : "", /not connected: set ORBIT_NOTION_TOKEN and ORBIT_TEAM_BOARD/);
  assert.equal(pageId("https://app.notion.com/p/ORBIT-Agent-Handoffs-411c10896bb38089b98af8384a8b3362?pvs=204"), "411c10896bb38089b98af8384a8b3362");
  assert.equal(pageId("Feed-411c10896bb38089b98af8384a8b3362"), "411c10896bb38089b98af8384a8b3362", "hex letters in the title don't shift the id");

  const env = { ORBIT_NOTION_TOKEN: "secret_test", ORBIT_TEAM_BOARD: "411c10896bb38089b98af8384a8b3362" };
  const calls: string[] = [];
  const para = (id: string, text: string, href: string | null = null, has_children = false) => ({ id, type: "paragraph", has_children, paragraph: { rich_text: [{ plain_text: text, href }] } });
  const pages: Record<string, unknown> = {
    "411c10896bb38089b98af8384a8b3362": { results: [para("b1", "Agent 3 — Status: smoke", null, true)], has_more: true, next_cursor: "c2" },
    "411c10896bb38089b98af8384a8b3362&c2": { results: [para("b3", "Agent 7 | PASS | next: Andreas, merge decision on #426", "https://github.com/o/r/pull/426")], has_more: false },
    b1: { results: [{ id: "b2", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "IN PROGRESS", href: null }] } }], has_more: false },
  };
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer secret_test");
    const m = /blocks\/([^/]+)\/children\?page_size=100(?:&start_cursor=(\w+))?/.exec(url)!;
    return Response.json(pages[m[2] ? `${m[1]}&${m[2]}` : m[1]]);
  };
  const r = await readBoard(env, fetcher, 1_000);
  assert.ok(r.live);
  assert.deepEqual(r.live && r.blocks, [{ text: "Agent 3 — Status: smoke", links: [] }, { text: "IN PROGRESS", links: [] }, { text: "Agent 7 | PASS | next: Andreas, merge decision on #426", links: ["https://github.com/o/r/pull/426"] }]);
  assert.equal(calls.length, 3, "page, its nested bullets, then the next page");
  await readBoard(env, fetcher, 30_000);
  assert.equal(calls.length, 3, "cached for a minute");

  forgetBoard();
  const denied = await readBoard(env, async () => new Response("{}", { status: 404 }), 2_000);
  assert.deepEqual(denied, { live: false, reason: "the board couldn't be read: Notion answered 404 (share the page with the integration)" });
  forgetBoard();
});
