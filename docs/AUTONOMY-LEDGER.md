# Autonomy ledger

One status per roadmap item (AUTONOMY-ROADMAP, 29 Oct 2026). Statuses: **not started · in progress · implemented · verified in fixtures · verified live · blocked**.
"Verified in fixtures" = a deterministic test in `tests/` exercises the real code path with fakes. Nothing here is verified live: no Windows
deployment, live model run or real database contention has been checked for this ledger. Revision: `7294a89` (main) unless a branch is named.
Update a row when its evidence changes; don't upgrade a status without a pointer.

| Item | Status | Rev | Evidence / gap |
|---|---|---|---|
| A01 Inventory + pilot | in progress | research-pilot | Pilot chosen: G01 (roadmap default). Owner-entered manual-minutes baseline per run exists; no workflow inventory yet |
| A02 Workflow contracts | verified in fixtures | research-pilot | `Contract` on recipes (`recipes-pure.ts`), carried into `MissionDoc.contract`; `tests/research-pilot.test.ts`. Contract budget enforced per step via chain-step `minutes`/`calls` → `createBudget` |
| A03 Standing grants | not started | 7294a89 | `autonomy-pure.ts`, `trust-pure.ts` are levels, not scoped grants |
| A04 One action boundary | in progress | 7294a89 | Approval gate in `agents.ts`; `policy-pure.ts`. Not all entry points proven equivalent |
| A05 Capability inventory | implemented | 7294a89 | `capability.ts`, `doctor.ts`, `version-pure.ts`; "verified" vs "configured" split not complete |
| A06 Baselines + release evidence | in progress | 7294a89 | Run metrics on pilot missions only; CI status not refreshed |
| B01 Exclusive ownership | verified in fixtures | 7294a89 | `task-claim-pure.ts`; `tests/mission-scenario.test.ts` (two workers). No real Postgres contention |
| B02 Attempt-based recovery | verified in fixtures | 7294a89 | `completion-pure.ts` attempts/uncertain; mission-scenario crash-after-write. Not every effectful path has attempt ids |
| B03 Event ack + replay | implemented | 7294a89 | `durable.ts` (#289). Persistence-failure/restart cases not checked here |
| B04 Deadlines + cancellation | in progress | 7294a89 | Task budgets/abort signals exist; SDK path has no proven elapsed-time abort |
| B05 Serialize conversations | not started | 7294a89 | Concurrent phone/desktop risk open |
| B06 Recovery as capability | in progress | 7294a89 | `backup.ts`, `docs/RECOVERY.md`; no restore drill with project data |
| C01 Chat/project memory scope | not started | 7294a89 | Chat scope still approximated by expiry |
| C02 Temporal interpretation EN/ET | not started | 7294a89 | Known wrong cases in roadmap §1 |
| C03 Privacy across turns | not started | 7294a89 | No multi-turn test |
| C04 Authoritative project state | implemented | 7294a89 | `checkpoint.ts`, `project-record-pure.ts`; conflict detection missing |
| C05 Decisions beyond regex | in progress | 7294a89 | Editable checkpoint lines; capture still regex-based |
| C06 Session lifecycle / engine parity | not started | 7294a89 | Needs the actual PC |
| D01 Validity vs correctness | in progress | 7294a89 | Missions split executed vs read-back receipts (`missions-pure.ts`); broader categories not done |
| D02 Exact research evidence | verified in fixtures | main + research-pilot | `fetchedFromTrace`/`normUrl` source records (verification-correctness); pilot `checkReport` uses them across all steps |
| D03 Artifact validation | in progress | research-pilot | Pilot: report written, read back byte-equal, sections parsed. PDF/CSV checks in `mission-checks-pure.ts` remain weak |
| D04 Real test/deploy evidence | not started | 7294a89 | `checkTests` accepts zero tests |
| D05 Adversarial cases | in progress | 7294a89 | `real-requests-pure.ts` fixtures; planted false-success only in pilot test |
| D06 Replan from results | implemented | 7294a89 | `reviewStep` stop/revise; DISPROVED marker is still the main signal |
| E01 Capability gaps per workflow | not started | — | |
| E02 Executable tool contracts | not started | — | |
| E03 Browser capability | not started | — | |
| E04 Credentials + identity | not started | — | |
| E05 Service limits in planning | in progress | 7294a89 | `usage-meter.ts`, capacity-aware planning |
| E06 Continuous operation | not started | — | Host availability unknown |
| F01 One command surface | implemented | 7294a89 | `WorkView.tsx`; pilot launches from a typed request and Work → Workflows |
| F02 Resolvable exceptions | in progress | research-pilot | Workflow missions hold on a failed acceptance check with the exact check + options (retry report / accept / cancel); not yet for other missions |
| F03 Needs-you inbox | implemented | 7294a89 | `needs-you.ts`; dedup/snooze not checked here |
| F04 Result-focused brief | in progress | 7294a89 | `brief.ts` |
| F05 Visible authority + revocation | in progress | 7294a89 | Stop-all (`docs/STOP-ALL.md`); no grant view (needs A03) |
| F06 Learn preferences | not started | — | |
| G01 Research-to-deliverable pilot | verified in fixtures | research-pilot | `research-pilot-pure.ts` + `missions.ts pilotFinal`; e2e on real runner with fake model/fetch, restart mid-step, unreadable source, private-context refusal, tool allow-list, exception hold → accept/retry (`tests/research-pilot.test.ts`). 0 live runs of the 20 suggested |
| G02 Roblox operator | not started | — | |
| G03 Content operator | not started | — | |
| G04 Daily planning operator | in progress | 7294a89 | `plans.ts`, daily plan |
| G05 Outcomes → learning | not started | — | |
| G06 Promote to Operate | not started | — | Needs A03 + live pilot runs |
| H01 Outcome dashboard | in progress | research-pilot | Per-run metrics (accepted, interventions, minutes, owner baseline) on pilot missions; no aggregate view |
| H02 Ranked backlog | not started | — | |
| H03 Safe autonomous maintenance | in progress | 7294a89 | `self-improve-patch.ts` proposals |
| H04 Regular recovery tests | not started | — | |
| H05 Engines by measured performance | not started | — | |
| H06 Consolidate | not started | — | |
