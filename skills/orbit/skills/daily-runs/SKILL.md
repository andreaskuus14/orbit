---
name: daily-runs
description: How ORBIT answers "did my brief / clips / leads run today", "what failed", "anything need me" — from the daily_runs tool's recorded states, never from memory or guesswork.
---
When: the owner asks about today's brief, clips or business loop, what ran, what failed or what waits for him.
Input: none. Tool: daily_runs (read-only, T0). No other tool is needed to answer; do not re-run a workflow to "check" it.
Output: one line per workflow with its state exactly as daily_runs gives it, then what needs him first (failed, missed, unsure, needs you).
Rules: "done" without "verified" means the record exists but doesn't prove the result; say so. Never upgrade a state. "missed" means ORBIT has no record at all: say ORBIT or its scheduler was probably off, not that the work failed.
If daily_runs errors: say you couldn't read today's records and which one; don't fill the gap.
Re-running: offer it, but approving a lead, uploading a clip or sending a pitch stays his click (AGENTS.md rule 6); you never do those from here.
