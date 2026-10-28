# CORE on the Claude Agent SDK: evaluation and prototype

Roadmap §1.1, the item left open in `docs/CORE-CAPABILITY.md`. Branch `agent-sdk-study`.

**Recommendation: yes, move CORE to the SDK, one step at a time, behind `ORBIT_CORE_ENGINE=sdk`.** It fixes the problems CORE-CAPABILITY.md lists: tool calls get real ids, errors are structured, parallel tool calls work, sessions and prompt caching come built in, and text streams without parsing a JSON envelope. It uses the same Claude login as `claude -p`. The costs are about 320 MB more in `node_modules` and one licensing caveat, covered in point 1 below. Before making it the default, test it once on the Windows PC (see the end of this doc).

## Where the evidence comes from

- **Docs.** [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) (fetched as `agent-sdk.md`) and the [llms.txt index](https://code.claude.com/docs/llms.txt). The sub-pages `quickstart.md`, `custom-tools.md`, `permissions.md`, `sessions.md` and `cost-tracking.md` were **blocked in this sandbox** because a fetch-permission prompt went unanswered. They were not read, so the answers below lean on the next two sources.
- **The package.** `@anthropic-ai/claude-agent-sdk@0.3.296` (published 2026-10-09), installed in a scratch folder. Its `sdk.d.ts` (about 10k lines of documented types) and its README.
- **Two live runs** of that version, using the in-process MCP options the adapter uses. Auth in the sandbox came from its proxy, not a claude.ai login. Results:
  - The `init` message listed only `mcp__orbit__goal_status` and `mcp__orbit__read_news`: built-ins were off with `tools: []`. It also showed `mcp_servers: [{name:"orbit", status:"connected", source:"sdk"}]`, `permissionMode:"dontAsk"`, the bundled CLI at 2.1.296, and init after 2–4 s.
  - With haiku and the prompt "call goal_status, then read_news": the model issued **both tool calls in parallel**, with real ids `toolu_…`. Both handlers ran. The refused one came back as `is_error: true`, and the answer named the refusal.
  - Usage: `cache_creation_input_tokens: 1188` (as a 1-hour ephemeral cache), `cache_read_input_tokens: 976`, 3 turns, estimated cost $0.0005.
  - A plain string `prompt` worked with the SDK MCP server. No streaming-input mode was needed.

## Answers

### 1. Claude Max subscription login (no API key) on Windows

- **It works technically.** The SDK runs a bundled Claude Code binary. That binary reads the same sign-in as `claude`. `sdk.d.ts` documents `apiKeySource` as: *"'none' (no API key in use - e.g. claude.ai OAuth login…)"*. The usage data includes `subscription_type: 'pro' | 'max' | …` and claude.ai rate-limit windows, including one named `seven_day_oauth_apps`. The error types name the login failures: `authentication_failed`, `oauth_org_not_allowed`, `rate_limit`, `billing_error`. As with the CLI, an `ANTHROPIC_API_KEY` in ORBIT's environment would be billed instead. The adapter writes `agent sdk · <model> · subscription login | API key (…)` to the trace from the `init` message, so this is visible on every turn.
- **The licensing caveat**, quoted from the overview: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods…"* ORBIT is the owner's personal tool on his own PC, using his own login. It isn't offered to anyone else, which is the same position as today's `claude -p` wrapper. The SDK's terms are the Commercial Terms, though. If ORBIT is ever shared or sold, it must switch to an API key.
- **Windows.**
  - The package ships `@anthropic-ai/claude-agent-sdk-win32-x64` (and arm64) as an optional dependency containing `claude.exe`, 260 MB unpacked.
  - Claude Code on Windows refuses to start without Git Bash or PowerShell (the `shell_tool_missing` start-up error). The owner's `claude` already runs, so that's met.
  - **Not tested on Windows here.**

### 2. Sessions and resume

These are options on `query()`:

- `resume: <id>` and `continue` (the most recent session in `cwd`)
- `sessionId` (a UUID of our choosing)
- `forkSession`
- `persistSession` (default true; sessions are saved under `~/.claude/projects/`, keyed by `cwd`)
- `resumeSessionAt` (a message UUID)

The session id arrives on every message (`session_id`). A resumed session also keeps its cost total. This replaces the hand-made `--session-id`/`--resume` plumbing and `sessionInput()` in `claude.ts`/`core.ts`. The prototype runs stateless (`persistSession: false`), like the default CLI path. Resume is the next step.

### 3. Custom tools through in-process MCP, with `decide()` still the gate

- Tools are defined with `tool(name, description, zodShape, handler, { annotations: { readOnlyHint } })` and served by `createSdkMcpServer({ name: "orbit", tools })`. The model sees them as `mcp__orbit__<tool>`.
- The handler returns `{ content: [{type:"text", text}], isError }`.
- **The gate sits inside each handler.** It runs `skillDenied() ?? decide()` with the same context fields as core.ts and the same `You called <tool> <json>\nRESULT:` step records, then emits `policyEvent`. A refused call returns `Error: <reason>` and never runs. Permission modes therefore can't route around the gate.
- A tool definition can't bypass the gate: there's no way to reach ORBIT code except through `gated()`.
- Outside the handlers, the options shut everything else off:

  | Option | Effect |
  |---|---|
  | `tools: []` | No Bash, Read, Edit or WebFetch |
  | `settingSources: []` and `strictMcpConfig: true` | None of the owner's `~/.claude` hooks, plugins, MCP servers or CLAUDE.md load |
  | `cwd` | An empty temp folder |
  | `allowedTools` | Only our tools |
  | `permissionMode: "dontAsk"` | Anything else is denied |

  Leaving the mode out isn't safe: the type docs say the SDK *"picks… 'auto' where that is the default"*, which means a model classifier approves calls.
- `approvalGate` (`approval-pure.ts`) is untouched. It guards the owner-click send and publish routes, which no CORE tool reaches. T3 tools stay behind `decide()`'s `APPROVAL_PATHS`.
- **A new risk the SDK brings: parallel tool calls.** The live run showed both calls issued before either result came back. If they ran concurrently, a `read_news` running alongside a private `week_review` would pass `decide()` before the private result was in `steps`. The adapter queues tool runs (`serial()`), so every `decide()` sees all earlier results. This is tested.

### 4. Streaming

`includePartialMessages: true` emits `stream_event` messages that carry the raw Messages API events. `readMessage` forwards top-level `text_delta`s and skips subagent ones (`parent_tool_use_id`). There's no JSON envelope to decode, so `partialAnswer()` isn't needed. Text written before a tool call is cleared with `onReset()`, the same as today.

### 5. Cost and caching

- `result` carries `usage`, including cache read/write and `iterations`, plus `modelUsage` per model, `num_turns` and `total_cost_usd`. The cost is documented as *"An estimate, not a billing statement"*. On the subscription it isn't billed per token: what matters is the plan's rate limits (`rate_limit_event`).
- **Caching** works automatically within a turn, as seen in the live run: a 1-hour cache write, then cache reads on later steps. Today each `claude -p` step is a fresh process that re-sends everything, so a resumed SDK session should cache across a chat's turns as well.
- `maxBudgetUsd` is available as a per-call spending cap.
- The adapter records tokens through the existing `recordUsage` (cost stays 0, as today).

### 6. Speed

`query()` spawns the bundled CLI, and init took 2–4 s here, about the same as `claude -p`. `startup()` pre-warms a process, which would replace `warmClaude`'s spare CLIs.

## The prototype

`ORBIT_CORE_ENGINE=sdk` (default unset, so the `claude -p` loop is unchanged) runs CORE's turn through the SDK. It uses the same memories and context prompt and the same `system` prompt, with the JSON-envelope section swapped for native tool calls (`nativeSystem`).

| File | What |
|---|---|
| `src/lib/core-sdk-pure.ts` | Pure mapping: tool names, MCP results, `gated()` (skillDenied + decide + step record), `serial()`, `sdkOptions()`, `readMessage()` (SDK message → delta / init / `StreamResult`), `authMode()` |
| `src/lib/core-sdk.ts` | `sdkTurn()`: the in-process MCP server with 3 read-only tools (`fetch_url` T1, `read_news` T1, `goal_status` T0), streaming, trace, usage. The SDK is loaded by dynamic import only on this path |
| `src/lib/core.ts` | One `if (CORE_ENGINE === "sdk") … else for (…)` before the step loop. Citations, answer checks and the fallback note run as before |
| `tests/core-sdk.test.ts` | 12 tests: name mapping, read-only tiers, error mapping, `decide()` refusals never run (Stop-all, link taint, skill limits, unknown tools), private-result taint carries over, `serial()` ordering, options isolation, message mapping |
| `package.json` | `@anthropic-ai/claude-agent-sdk` **0.3.296** and `zod` **4.6.7** (a peer of the SDK; both exact and over 2 weeks old). No lockfile in the repo, so install resolves fresh. A scratch install worked (63 MB JS plus the platform binary) |
| `next.config.ts` | SDK added to `serverExternalPackages` (it resolves and spawns its native binary) |

**Parity with the `claude -p` path (roadmap 8, item 1.2):**

- **Every CORE tool** is registered: `sdkTools(MODULE_TOOLS)` = core.ts's own six (`CORE_BUILTINS`) plus every module tool from `core-modules.ts`. A test checks the list against core.ts's TOOLS prompt and dispatch, the module lists and `TIERS` (none missing, none extra). Inputs pass through (`z.looseObject`): the prompt documents them and each runner validates them, as on the CLI path.
- Each handler runs core.ts's own `exec` (navigate / module / runCoreTool) and `record` (eval row, trace row with evidence, activity log) behind `gated()` (skillDenied + decide, serial, step record) and `policyEvent`. Approvals are untouched.
- **Sessions:** with `ORBIT_CORE_SESSION=resume`, ORBIT's chat id keeps its `CliSession`: the first turn starts the SDK session as `sessionId` (ORBIT's UUID), later turns `resume` it (`sdkSession`). A failed resume drops it and redoes the turn statelessly, with the same trace note.
- **Images** go as one streaming-input `SDKUserMessage` (`userMessage`, the same blocks as the CLI's stdin). **Voice tail** and language rule are appended as on the CLI path.
- **Errors:** the SDK's assistant error codes (`rate_limit`, `authentication_failed`, …) become words `describeFailure` already knows (`sdkFailure`), so the owner sees the same usage-limit / login messages.
- **Fallbacks and review:** the CLI path's `recover` (session → stateless, `--effort` dropped, fast/deep → main model) and deep self-review are shared closures in core.ts. A fast-model tool call stops the SDK turn and redoes it on the main model. A redo after tools ran carries their results, so writes aren't repeated.

**Gaps left:** no per-step "answer now" on the last step (`maxTurns` ends the turn with `error_max_turns` instead); the deep time budget isn't enforced inside an SDK turn (only before it); the deep "plan in thought" note is JSON-specific and not sent (effort is); the local offline brain isn't used; `warmCore` doesn't pre-warm SDK processes; the image prompt (streaming input) and resume are untested live.

## Next steps

1. **On the Windows PC:** run `npm install`, set `ORBIT_CORE_ENGINE=sdk`, and ask *"what are my goals?"* and *"news about Estonia today"*. The trace should read `subscription login` and show the tool rows.
2. Port the remaining tools as zod shapes, each through `gated()`. Delete the JSON-envelope prompt once all of them run on the SDK.
3. Add session resume per chat (`resume`, with `persistSession` on and a fixed `cwd`), and `startup()` pre-warm.
4. Add images, voice, deep effort with review, and fallback. Then switch the default.
