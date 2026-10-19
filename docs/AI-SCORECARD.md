# CORE memory retrieval and the AI scorecard

## What changed

The original full-text/vector reciprocal-rank fusion and cutoff are retained. Ordinary Memories-screen and agent searches keep their pre-PR behaviour. There is no new word-overlap reranker or recency sort on ordinary candidates. CORE still takes eight memories; existing passage selection then chooses excerpts from long documents.

Only CORE passes the chat's **structured project name** separately from the project prompt. One additional lookup reads up to 25 metadata rows (`id,title,tags,folder`), not memory bodies. Among the original selected hits, at most two project notes can move forward after the first two protected results. No original selected hit can be evicted. If fewer than eight hits exist, at most two matching project notes can fill unused slots. For a specific question, all non-project query terms must also match the note's metadata; a project name alone earns no bonus. Negated questions keep the original order because this heuristic cannot understand negation. A vague question with no substantive terms can receive up to two contextual notes.

Only the final selected ids are hydrated: at most eight full bodies for CORE, rather than 75. The metadata lookup prefers recent project rows, but never replaces an original hit on that basis. Instructions and pinned notes are never search queries. There is one optional embedding request and no extra Claude call. A failed optional lookup leaves the ordinary results intact.

Project matching is a relevance hint, **not** an ownership or confidentiality boundary: memories do not have a chat-project foreign key. Explicit questions about other projects retain their original matches. All reads retain RLS, and background searches with a user id retain explicit owner filters on lookup and hydration. No migration or new setting is required.

This deliberately conservative change does not rescue relevant notes below the original cutoff, correct existing full-text relevance problems, or infer supersession. Those need separately measured changes. Learning, approvals, budgets, publishing and recent-memory fallback are unchanged.

## Offline retrieval comparison

Run `npm run eval:ai`, or `npm run eval:ai -- --json` for the full report.

The 24 synthetic cases in `evals/memory-cases.ts` supply separate raw full-text and semantic id lists. `evals/legacy-memory-pure.ts` freezes the original fusion-and-cutoff algorithm from commit `e5d586a`; the upgraded path uses the runtime fusion and contextual selector. Both receive identical channel outputs. Tests also compare ordinary query-flow results with that frozen baseline. The council's project-crowding and food/semantic counterexamples, negation, full result sets, irrelevant project notes and a known cutoff limitation remain in the suite.

Reports include per-case selected ids, top-1 accuracy, recall@3, recall@8 and mean reciprocal rank. Empty-retrieval cases count as correct only when no result is returned. The command fails if a case regresses in recall@8 or reciprocal rank; tests separately require every original selected id to survive. Unsolved cases remain visible rather than being rewritten to produce a perfect score.

These are **curated selection fixtures**, not a live Supabase/embedding benchmark or proof that agents answer correctly. In particular they cannot measure database ranking, embedding recall or live answer quality. They replace the first iteration's hand-ordered-pool comparison; its 3/24 to 24/24 result is withdrawn and must not be compared with the revised suite. Timing measures fixture selection only. Production behaviour still needs recorded runs below.

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
