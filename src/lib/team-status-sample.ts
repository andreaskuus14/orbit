// Sample handoff board for Mission Control: shown (and labelled as a sample) when the live board can't be read, and used by the
// tests. Modelled on real ORBIT board updates from 2026-11-07, in board order (oldest first). Repository work only.
import type { Block } from "./team-status-pure";

const PR = (n: number) => `https://github.com/andreaskuus14/orbit/pull/${n}`;
const RUN = (n: number) => `https://github.com/andreaskuus14/orbit/actions/runs/${n}`;

export const SAMPLE_BOARD: Block[] = [
  { text: "Agent 8 — cloud write confirmed" },
  { text: "Agent 1 — Project handoff test passed." },
  { text: "Agent 6 — Task: owner-authorized merge of #423 then #424 (merges only, no deploy). Pre-checks matched. Status: gate running. Nothing deployed." },
  { text: "Agent 1 | shipped: #424, approved actions that start and then throw are \"uncertain\" with the attempt ID kept | PR #424 head 9a2fec3, in main 02b6c8f | next: Agent 3 runs the Windows smoke of 02b6c8f | no file claims", links: [PR(424)] },
  { text: "Agent 3 → Agent 2 — Finished: Windows check of #425 + #417 combined. Run 42376123647: success, 61 passed / 0 failed. Both PRs still draft, nothing merged or deployed. Next: Andreas decides on #417 and #425.", links: [RUN(42376123647), PR(425)] },
  { text: "Agent 4 | #427 (draft) | verified: a deleted project's old name-tagged memories stay out of a same-named new project | gate 3336 pass / 0 fail / 1 skipped, CI green | next: Agent 6 re-reviews that exact head read-only", links: [PR(427)] },
  { text: "Agent 6 | shipped: #423 + #424 merged (owner-authorized), gate on final main passes (3333 pass / 0 fail / 1 skipped) | main 02b6c8f | next: Agent 3 Windows smoke of 02b6c8f | now starting: read-only re-review of #427, no file claims" },
  { text: "Agent 9 | verified via git: main 02b6c8f; #426 head f419f8f | PR/SHA: none (read-only reporter) | next: Agent 7 re-reviews #426 | Blocked: no GitHub API here, so CI states come from board reports. Coordinator: route read-only GitHub API access." },
  { text: "Agent 3 — Status: isolated smoke of main 02b6c8f: IN PROGRESS, no result yet." },
  { text: "The first Linux setup failed because the container ran out of disk. Space is freed and it's being restarted." },
  { text: "Agent 2 | shipped: orbit-test runner; Windows run 22 ok / 0 failed | PR #428 (draft), SHA 451193e | next: Agent 3 re-runs the Windows check, then Andreas decides on #417, #425 and #428 | file claims released. Nothing merged or deployed; unattended releases off.", links: [PR(428), RUN(42386506873)] },
  { text: "Agent 7 | #426 re-check at Agent 8's new head: PASS | gate 3336 pass / 0 fail / 1 skipped | Next: Andreas, merge decision on #426. Nothing merged or deployed.", links: [PR(426)] },
  { text: "Agent 3 | isolated smoke of main FAIL (1 Windows unit test, teardown only); everything else PASS | 02b6c8f | next: Coordinator, route the ws-server Windows failure.", links: [RUN(42388172874)] },
  { text: "Agent 8 | Agent 3's partial-restore finding: recovery FAILS to return the exact pre-restore state | Not caused by #426: same restore code as main | next: Andreas/Coordinator assign the fix | no file claims.", links: [RUN(42390424519)] },
  { text: "Agent 3 | claiming the Windows workspace-Stop follow-up | branch fix/ws-stop-waits-exit from main 02b6c8f | Status: reproducing on Windows, then fixing." },
  { text: "ChatGPT Coordinator — Task: reconcile agent progress and blockers from the shared conversations and this board. Blocker: START-HERE.md and the local reservation files are not accessible in this session." },
];
