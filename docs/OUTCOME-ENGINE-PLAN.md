# ORBIT Outcome Engine: smallest implementation plan

Base: main @ 6125e3a (22 Nov 2026). Rule: no new system. **An outcome is a Mission.** Missions already have one authoritative
record (`missions-pure.ts` MissionDoc), an agent chain whose finished steps never rerun, receipts that only ORBIT itself checked,
deterministic checks (`mission-checks-pure.ts`), an exception hold when acceptance fails, hash-bound approvals (`approval-pure.ts`,
`approval-bind-pure.ts`) and one progress model (`progress-pure.ts`). Goals (`goals-pure.ts`) stay for multi-day aims; an outcome
is one job.

## What exists → what's missing

| Idea | Exists | Missing |
|---|---|---|
| "Tell ORBIT the result you want" | `start_mission` tool, `inferAcceptance`, `createMission` | Agreed checks drafted per outcome type and confirmed once before work starts |
| One live plan across planets | Chain steps = agent tasks (agents already hold planet tools) | Nothing structural |
| Independent steps in parallel | — chains are strictly sequential (`chains-pure.ts`: step k gets step k−1's result) | `after` dependencies |
| Done only when checks pass | `verified`, `checks`, `hold` | Failed check → targeted fix → re-check (today it goes straight to hold) |
| Reuse finished work | Done steps never rerun; receipts | — |
| One review desk | Data is in MissionDoc + approvals queue | A builder + one card |
| Early useful progress | `progress-pure` builds from missions | Milestone lines ("plan agreed", "first draft ready") |
| Approval for send/publish/upload/spend | Hash-bound approvals | — (must stay untouched) |

## PRs (each small, each with its own tests, in this order)

### PR 1. Outcome brief (pure: `outcome-pure.ts`)
`outcomeDraft(text, lang)` → `{ objective, deliverable, checks: CheckSpec[], approvalPoints, steps }`. CheckSpec templates per type, reusing
existing checkers only:
- Roblox update → bug-hunt tests (#674) + playtesters report (#693) + place saved.
- Week of Shorts → clip count = 7, frame review passes (`reviewFrames`), captions present; scheduling = approval point.
- Client shop → workspace check (`workspace-check-pure`) passes, links resolve, checkout page present; publishing = approval point.
- Anything else → `inferAcceptance` + "artifact valid".

The draft is a mission in `waiting-input`; his one OK starts it. The checks are frozen at that moment.
**Tests:** the three example briefs map to the expected checks; any step that sends, publishes, uploads or spends has an approval point;
an unknown brief still gets at least one non-model check; Estonian and English briefs.

### PR 2. Parallel steps (`chains-pure.ts`, `chains.ts`)
Optional `after?: number[]` per step. Default `[k-1]`, so every existing chain behaves exactly as today. `ready(meta, children)` returns
the steps whose dependencies are all done; a step receives only its dependencies' results. Concurrency cap: 3 (existing claim and lease are unchanged).
**Tests:** sequential chains are unchanged (snapshot existing chains.test cases); fan-out then fan-in; a failed dependency blocks only its dependents;
a restart resumes the same ready set; a cycle or a bad index is rejected by `validateMission`.

### PR 3. Fix and retry (`missions-pure.ts`, `missions.ts`)
On a failed check: `repairStep(check, attempt)` adds one step aimed at that check's step only (its output, the check's exact failure text), at most
`MAX_RETRIES` (2) per check. Then re-run only that check, then the deliverable-level checks. After the limit, use the existing hold.
`verified` is true only when every frozen check passes. Never relabel a weak result as done.
**Tests:** fail → fix → pass becomes verified with both attempts logged; fail twice becomes a hold showing the exact check; a fix step can't add
outward actions; checks frozen in PR 1 can't be edited by an agent.

### PR 4. Review desk (pure builder `review-desk-pure.ts` + `ReviewDesk.tsx`)
`reviewDesk(mission, approvals)` →
- the deliverable (artifact or workspace preview link),
- proof (evidence line plus each check: ✓ or ✗ and what it checked),
- what changed (receipts grouped by kind: files, tasks, projects),
- what's waiting for him (the exact approval items, each opening where its own Approve lives; never approves itself),
- a short timeline.

The desk replaces the mission detail in MissionsPanel. A finished mission's Progress card opens it from every planet's Results.
**Tests:** a verified, a held and a failed mission each render the right sections; approvals are listed but never auto-approved;
nothing from LIFE or the journal is included.

### PR 5. Entry + early progress
CORE intent ("make a week of Shorts", "launch this Roblox update", "turn this into a shop") → PR 1 draft card in chat with one OK.
`progress-pure` adds milestone lines from receipts ("plan agreed", "first draft ready", "checks running", "fixing: <check>").
**Tests:** intent detection for the three phrasings (EN + ET); a non-outcome question doesn't trigger it; progress shows a milestone within the
first finished step.

## Speed without lowering quality
- Show the agreed plan immediately (PR 1); the first finished step updates the card.
- Reuse: done steps never rerun; repairs touch one step only.
- Cheap deterministic checks between steps (the existing review); deeper checks (playtests, frame review, workspace render) only on the deliverable.

## How we know it works (one-week trial after PR 5)
Run three real outcomes: one Roblox update, one week of Shorts, one client shop. Record:
- time to first useful progress,
- whether it reached verified without his fixes,
- the number of repair loops,
- any check that passed but the result was wrong (a false pass is worse than a fail).
