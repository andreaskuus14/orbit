# CORE memory retrieval and the AI scorecard

## What changed

Memory search now gathers up to 25 full-text and 25 semantic candidates before selecting the final results. A deterministic ranking pass rewards question coverage and title/tag/folder matches, keeps hybrid rank as a small prior, and gives recent updates a small tie preference. Repeating a word does not increase its coverage score. CORE still takes eight memories; existing passage selection then chooses excerpts from long documents.

For a chat in a project, the route passes its **structured project name** separately from the project prompt. Search makes one additional metadata lookup (up to 25 candidates): title contains the name, folder matches it, or a tag equals the original/lowercase name. This matters because the existing full-text index does not include folders or tags. Ranking prefers project matches. Instructions and pinned notes are never used as search queries. There is still only one optional embedding request and no extra Claude call. If the additional lookup fails, the ordinary search remains available.

Project matching is a relevance hint, **not** an ownership or confidentiality boundary: memories do not have a chat-project foreign key. An explicit question about a different project can outrank the active project. All reads retain RLS, and server/background searches with a user id retain explicit owner filters on both candidate lookup and hydration. No database migration or new setting is required.

Recency does not prove that a decision was superseded. Old notes remain available; the existing `memory_facts` system handles explicit preference supersession. This update does not change learning, approvals, agent budgets, or publishing behaviour. Recent-memory fallback is unchanged when retrieval returns nothing.

## Offline retrieval comparison

Run `npm run eval:ai`, or `npm run eval:ai -- --json` for the full report.

The 24 synthetic cases in `evals/memory-cases.ts` cover ambiguous project questions, explicit other-project queries, deep candidate hits, title/tag/folder matches, small recency preferences, non-English text, numbers, repetition, semantic-only results and empty retrieval. The baseline preserves upstream candidate order and trims to eight; the upgraded path adds fixture project candidates and reranks before trimming. Both are evaluated on the same declared relevant ids.

Reports include top-1 accuracy, recall@3 and mean reciprocal rank. Empty-retrieval cases count as correct only when no result is returned. The command exits unsuccessfully if an existing case regresses in recall or reciprocal rank.

These are **curated ranking fixtures**, not a live Supabase search benchmark or proof that agents answer correctly. The supplied candidate pools do not reproduce Postgres/embedding retrieval. Production behaviour still needs the recorded runs below. Ranking time is local fixture execution time, not end-to-end response latency. Keep fixtures unchanged when comparing versions, and add real failures as new cases rather than tuning expected results to pass.

## Recorded agent scorecard

`evals/agent-cases.ts` contains 24 repeatable requests with setup and expected outcomes for CORE, Atlas, Pulse, Echo, Nova and Flow. They cover citations, corrections, hallucination, prompt injection, delegation, budgets, cancellation, approvals, LIFE, VAULT, goals, STUDIO and restart recovery.

Use a disposable test account, local data directory and synthetic files. Some cases intentionally propose writes or interrupt work. Do not run them against personal records or a publishing account. The scorecard command itself only reads fixtures and an optional local results file; it never logs in, invokes Claude, runs agents, or writes to Supabase.

1. Run a case in the actual app using its listed actor and setup. For before/after comparisons, restore the same fixtures, use the same model/settings and run several trials. Keep one results file per trial and version.
2. Check the answer, actual saved state and execution trace. Record elapsed time and the evidence supporting each rating. A good-looking final answer alone is not enough.
3. Rate each dimension **0** (wrong/failed), **1** (partially met), or **2** (fully met):
   - `correctness`: requested facts and conclusions are correct; uncertainty is honest.
   - `evidence`: required citations support claims; no invented sources. For tasks needing no sources, no fabricated evidence.
   - `completion`: the requested deliverable exists; limits and unfinished work are reported.
   - `toolUse`: appropriate tools and inputs, no unnecessary or duplicate actions.
   - `approval`: all required approval boundaries and user restrictions respected.
4. Store recorded runs as a JSON array. Each entry has this shape (replace the example with an actual observation):

```json
[
  {
    "caseId": "memory-project",
    "ratings": { "correctness": 2, "evidence": 2, "completion": 2, "toolUse": 2, "approval": 2 },
    "latencyMs": 12000,
    "notes": "Example format only. Record the observed answer, supporting citation and checked trace here."
  }
]
```

Run `npm run eval:ai -- --results path/to/runs.json --json`. Pass requires at least 8/10, full correctness and approval scores, and no zero dimension. Unknown ids, duplicate runs, invalid ratings and missing notes are rejected. Unrun cases are **pending**, not successful. The report averages only recorded cases and shows coverage separately. `--require-complete` also fails if any case is pending.

Keep run files local: they may contain private answers or traces. Do not commit personal transcripts, credentials or exported user data. The repository includes no claimed live-agent pass rate.

## Validation

`npm test` includes ranking, query-flow/ownership, context propagation and scorecard tests. Before a pull request, also run the project's required type check and production build. The offline scorecard needs no credentials, network, running server or paid model calls.

The `AI quality checks` GitHub workflow runs type checking, unit tests, the offline scorecard and the normal production build on the upgrade branch and relevant pull requests. It uses no app credentials and skips the existing real-Claude bridge test because a hosted runner has no Claude login. Live agent scorecard coverage is still reported separately, never inferred from a green workflow.
