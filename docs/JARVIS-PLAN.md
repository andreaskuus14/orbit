# ORBIT as a JARVIS-style assistant: gaps, reuse, milestones

Written 2026-11-05 from the code at `da56173` plus three read-only code surveys. Line refs are as of that commit.

## 1. Where ORBIT stands against the eight capabilities

| Capability | Implemented | Partial | Missing / idea only |
|---|---|---|---|
| 1. Personal context | Facts with source, confidence, superseded/retracted history, entity ids, valid_from/until (0008, 0012, 0019, 0024); owner edit / mark wrong / forget (BeliefsPanel, MemoryControls) | Decisions and goals are only memory `kind` labels; freshness = recheck queue | **Commitments**: `World.commitments` is always `[]` (world.ts:41). No decision record (why, date, revisit) |
| 2. Execution | Missions with step retry and failure classes (missions-pure.ts); agent tasks resume after restart; durable step log + leases (job-log.ts); bg CORE turns resume | Goals resume only when ORBIT is opened (`resumeGoals` is called from /api/morning, not the scheduler) | — |
| 3. Background | 60 s scheduler tick inside the Next process (scheduler.ts); hidden supervisor restarts the server (launch.ps1); Task Scheduler wakes the PC 04:30 | All of it dies with the Next process; off without `SUPABASE_SECRET_KEY` | **No missed-run detection**: a brief that never fired leaves no trace and no alert |
| 4. Initiative | Proactive suggestions (6 h, capped); Herald toasts; Web Push + ntfy with quiet hours and coalescing | The 07:30 brief itself sends no push | **No single daily answer to "did my things run?"** |
| 5. Verification | Receipts (verified/partly/unverified/failed); missions' read-back checks; STUDIO's upload hash + YouTube read-back; tool-less verifier | Morning brief and business loop are self-reported | No shared outcome record across workflows |
| 6. Controlled autonomy | `decide()` tiers T0–T3, fail-closed, on all three CORE engines and MCP plugins; exact-content approval hashes for send/publish/spend; Stop-all everywhere | Agent tools use their own approval gate, not `decide()` | **Conflict to decide**: "Auto with limits" (off by default) can send 3 emails/day and publish 1 Short/day without a per-item click (autonomy-pure.ts:43-49), which AGENTS.md rule 6 says never happens |
| 7. Voice | Wake word (regex on transcripts), local Whisper, Kokoro TTS, barge-in, same chat for voice and text | Wake word isn't a keyword-spotting model | Real phone number |
| 8. Learning | Corrections → proposed lessons; style playbook with blocklist; nightly retirement of harmful rules | Kept corrections are written to `evals/corrections/` | **The eval runner never reads `evals/corrections/`** (scripts/eval-core.ts:22): corrections never become tests |

Models: every call goes through the `claude` CLI; model names are env-swappable (`ORBIT_MODEL*`), the provider is not. Ollama is a no-tools fallback only. That's acceptable today: new Claude models arrive by changing an env value.

## 2. The three daily workflows

| | Trigger | State lives in | Verified? | Gap that blocked "it just runs" |
|---|---|---|---|---|
| 07:30 brief | scheduler → `runPulse` | `briefings`, `job_runs` | Self-reported | Missed runs are silent; no phone signal |
| STUDIO clips | inbox watcher 30 s, scout, night shift | `ORBIT_STUDIO_DIR/jobs/*.json` | **Yes**: hash + YouTube read-back | An unsure upload only shows inside STUDIO |
| Business loop | automation template, off until saved | `automations`, `tasks`, `prospects` | Receipt of the agent run | Off by default; "needs you" buried in Agents; demo is a plan, not a site |

None of the three shared an outcome model, and nothing told you in one place whether today's work happened.

## 3. Reuse research: one recommendation per gap

Dev-only means it helps build ORBIT and is **not** an ORBIT feature. Runtime means CORE can invoke it for you.

| Gap | Candidates looked at | Recommendation | Kind |
|---|---|---|---|
| One honest daily status (M1) | Healthchecks.io-style dead-man pings; extending ORBIT's own records | **Extend ORBIT's records.** Each workflow already writes the evidence; an outside pinger would only know "ran", not "verified" or "waits for you", and adds an account plus data leaving the PC | Runtime |
| Phone signal | ntfy (Apache-2.0/GPL-2.0, already wired with quiet hours and Approve/Reject buttons); Pushover (paid); Telegram bot | **Reuse ORBIT's ntfy.** Labels only, because a public-server topic can be read by anyone who guesses it | Runtime |
| Server dies with Next / OS service | NSSM (no stable release in years, plaintext env in registry), WinSW (XML with plaintext env), Servy (maintained, encrypted credentials, log rotation); keep launch.ps1 supervisor | **Keep launch.ps1 for now**; evaluate Servy only if the supervisor fails in practice. A Windows service runs as another account and would lose your Claude CLI login, which is the bigger risk | Runtime infra |
| MCP servers needing an API key (vidIQ etc.) | MCP TS SDK 1.32.2 (installed) `StreamableHTTPClientTransport` options `requestInit.headers` and `authProvider` | **Extend `plugins.ts`** with an optional headers field read from `.env.local`. No new dependency | Runtime (M2) |
| Calendar / Gmail | Google's official Calendar MCP (`calendarmcp.googleapis.com`, OAuth, **Developer Preview** only); community `workspace-mcp`; ORBIT's own `gcal.ts` (read-only OAuth, already used by plan_day) | **Keep `gcal.ts`** for Calendar. Revisit Google's MCP when it leaves preview. Gmail drafts: Google's MCP once GA, or none; sending stays your click | Runtime (M3) |
| Leads without a website | Overpass/OSM (ODbL, attribution, fair-use rate limits; `website` tag is often missing, so it gives candidates, not proof); paid scraping actors | **Overpass for candidates + ORBIT's existing `fetch_url` check** before `save_lead`, as the lead-hunting skill already demands | Runtime (M3) |
| Corrections → tests | promptfoo, Braintrust; extending `scripts/eval-core.ts` | **Extend eval-core.ts** to also read `evals/corrections/`. Ten lines, and it uses the cases ORBIT already writes | Dev |
| Code review / CI | Claude Code review agents, GitHub Actions (`.github/` exists) | Use them while building | Dev only, never an ORBIT feature |

Sources: [MCP TS SDK StreamableHTTP options](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/client/streamableHttp.html), [Google Calendar MCP server](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server), [Servy vs NSSM vs WinSW](https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46). The ntfy and Overpass notes come from their project docs and should be rechecked before M3.

## 4. Milestones by demonstrated capability

Each milestone is done when the task below works on the PC with real data, not when the code merges.

### M1. "Did my day's work happen?" (built on branch `daily-runs`)
- **You ask:** "did my brief run?", "what ran today?", "anything need me?", or open `/api/daily`.
- **Runs on its own:** reads the three workflows' records; at 10:30 (`ORBIT_DAILY_DIGEST`) pushes one label-only digest to ntfy, e.g. `Brief: MISSED · Clips: needs you · Leads: done ✓`.
- **Needs approval:** nothing. It is read-only (T0) and never re-runs or approves anything.
- **Verified by:** `tests/daily.test.ts` (states, grace windows, verified rules, digest privacy, once-a-day); an end-to-end run of `daily.ts` against real clip-job files and a local ntfy endpoint; `npm run gate`. **Live check on the PC:** after one real morning, `/api/daily` matches what STUDIO, Agents and INTELLIGENCE show, and the push arrives once.

### M2. "Every workflow completes daily without me fixing it"
- **You ask:** nothing. The three workflows run, and M1's digest shows `done ✓` or `needs you`, never `MISSED` or `unsure`, for 5 days in a row.
- **Work:** save and tune the business-loop CONDITION; resume goals from the scheduler; a missed-run catch-up for the brief; MCP header support for vidIQ; corrections → eval cases.
- **Needs approval:** filing a lead, every email, every upload, every spend (unchanged).
- **Verified by:** 5 consecutive daily digests plus `npm run eval`, including correction cases.

### M3. "Turn a goal into finished work across tools"
- **You ask:** "get 3 new clients this month", "post 3 Shorts this week".
- **Runs on its own:** Overpass candidates → fetch_url proof → demo site built in a workspace (not just a plan) → pitch draft; calendar-aware scheduling of Shorts.
- **Needs approval:** each send, publish and spend, plus permission changes.
- **Verified by:** the goal's metric moving (leads filed, replies, Shorts live), read back from the real systems.

### M4. "Talk to it like Jarvis"
- Voice continuity is already built. Remaining: a real keyword-spotting wake word and a phone line. Both are paid and approval-gated.

## 5. Decisions for Andreas
1. **Auto with limits** vs AGENTS.md rule 6: keep it (off by default, typed phrase, daily caps) and change the rule's wording, or remove the send/publish part.
2. The business loop is off until you save it with your CONDITION. M1 shows it as `off` until then.
3. The ntfy topic: self-host it, or keep the public server. The digest carries labels only either way.

## 6. Costs and upkeep
- M1: no new dependency, no new account, no model calls. It needs ntfy already set up for the push.
- Every milestone adds maintenance: the scheduler tick list grows, and each external integration (Google OAuth, Overpass limits, vidIQ credits) can break on the provider's side. Disable M1's push with `ORBIT_DAILY_DIGEST=off`; remove it by deleting `daily*.ts`, the scheduler line, the DAILY module and the skill.
