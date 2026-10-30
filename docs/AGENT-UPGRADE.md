# Agent upgrade (built-in roster)

Definitions: `src/lib/agent-defs-pure.ts` (pure; `agents.ts` re-exports `BUILTIN_AGENTS`). Eval suite: `evals/agent-suite.ts` (50 tasks,
5–6 per agent). Frozen "before" roster: `evals/agent-baseline.ts`. Run: `npm run eval:agents` (offline, no model calls),
`npm run eval:agents -- --results runs.json` to check recorded answers (`[{id, answer, seen?}]`).

## What every agent got

- **Definition of done** (`DONE WHEN:`) and an **output contract** (`OUTPUT:`): fixed EN/ET headings where the job has a shape, links as
  `[title](url)` with the exact URL a tool returned, open questions on their own line ending in `?` — the two things the AGT03 handoff
  (`chains-pure.buildHandoff`) already extracts as `evidence` and `questions` for the next step.
- **Self-check, run for real**: before delivery `agents.ts` runs `selfCheck()` on the draft (deterministic, no extra model call). On a failure
  the problems go back to the agent once ("fix once") while steps remain; the trace shows a `self-check` step. Checks: required headings,
  every cited URL appeared in a tool result (`normUrl`, from `mission-checks-pure`), `[m:id]` cites came from a tool, fenced json/csv
  parse (`checkFile`), Vector's numbers are in the tool data, role "must" lines (Flow mentions approval, QA ends Pass/Needs fixes, Pulse
  marks Confirmed/Single source, Forge has no TODO/lorem ipsum), no "I sent / published / paid" claims, Estonian answer for an Estonian request.
- **Rules**: never send/publish/buy/spend or claim it (AGENTS.md rule 6); Estonian output rules (õ/ä/ö/ü, ET headings, 30.10.2026, decimal
  comma, `4 500 €`).
- **Model routing** (`tier`): smart (`ORBIT_MODEL_SMART`) for planning and research synthesis, fast (`ORBIT_MODEL_FAST`) for extraction and
  structured fill-in, main (`ORBIT_MODEL`) otherwise. Custom agents stay on main.

## Per agent

| Agent | Tier | Tools: added / removed | Contract | Typical tasks (sources) |
|---|---|---|---|---|
| Nova | smart | + web_search | covers every part or marks it unfinished; names pending approvals | delegate research, quick facts, memory recall, partial-budget honesty (AGENT_CASES agent-delegate/agent-budget) |
| Atlas | smart | + web_search, − search_articles | Summary / Key findings / Uncertain / Sources, ≥1 read page per finding | official-docs comparisons, conflicts, paywalls (REPLAY research-*, AGENT_CASES research-*) |
| Pulse | main | — | every story linked, in window, Confirmed / Single source | briefings, last-hour window, duplicates (news-time, news-duplicates) |
| Echo | main | + vault_search, vault_read | every statement cites [m:id] or file name; newer note wins | themes, corrections, unknowns, VAULT lookups (real-requests en/et-file-route) |
| Forge | main | + vault_search, vault_read | complete, no placeholders, json/csv blocks parse | plans, JSON/CSV deliverables, memos from files, posts kept as documents |
| Vector | fast | − search_memory | Markdown table, every number from tool data | activity, per-agent counts, fail rates, "not tracked" |
| Sentinel | main | + web_search | Changes / Sources rated High/Medium/Low, or one line "No important changes" | change watch on news and pages |
| Flow | fast | — | states what runs, when, and that it waits for approval | weekly/event automations, duplicates, "email my team" (no send) |
| Orbit QA | main | + web_search | Verdicts / Overall, Pass only with no Unsupported/Contradicted | verify, contradict, unsupported, injection |

Not added on purpose: `ws_*` and `lead_update` stay CORE-only (their WORKSPACE/ORGANIZE modules carry taint rules agents don't have; no
agent role writes workspaces or leads). Vault tools are built-in only (custom agents can't pick them: `BUILTIN_ONLY_TOOLS`), and no
agent holding vault tools has an outbound tool (fetch_url / web_search / news). `web_search` from an agent refuses a query carrying
private task text (`outboundLeak`, like `fetch_url`) and is charged to the task budget.

## Before / after (offline, synthetic — not answer quality)

`npm run eval:agents` on this branch. "Readiness" = share of per-task definition checks passed: needed tools present, definition of done,
output contract, self-check step, send/spend rule, the model tier the task calls for, Estonian rule (ET tasks).

| Agent | Tasks | Before | After | Model-graded items pending |
|---|---|---|---|---|
| Nova | 6 | 14% | 100% | 2 |
| Atlas | 6 | 8% | 100% | 2 |
| Pulse | 5 | 16% | 100% | 0 |
| Echo | 6 | 11% | 100% | 0 |
| Forge | 6 | 14% | 100% | 2 |
| Vector | 6 | 16% | 100% | 0 |
| Sentinel | 5 | 13% | 100% | 1 |
| Flow | 5 | 16% | 100% | 1 |
| Orbit QA | 5 | 13% | 100% | 1 |

Read this honestly: the "after" rows are 100% because the checks describe what this upgrade added; they prove each definition now has the
pieces, not that answers got better. The answer checker itself is tested against good and seeded-bad answers in `tests/agent-defs.test.ts`.

## Needs a live run

- **Answer acceptance (50 tasks)**: run each suite task through the agent in a disposable test account, save `[{id, answer, seen}]` and
  `npm run eval:agents -- --results runs.json`. Not run here (no live models).
- **Model-graded rubric items (9, `judge`)**: score via recorded runs in `npm run eval:ai`.
- **Model routing cost/latency**: Atlas/Nova on the smart model are slower; Flow/Vector on the fast model may need a fallback if the fast
  model fumbles the JSON step format. Watch ANALYTICS → agent scorecards after a week.
- **Self-check false positives**: the Estonian guess and Vector's number check are heuristics; a false positive costs one extra model call
  and the answer is still delivered after the single fix round.
