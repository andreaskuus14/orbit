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

**Not in the prototype yet:**

- The other CORE tools (web_search, ask_agent, save_memory, navigate, module writes). The model is told only the offered tools exist.
- Images in attachments: these need the `AsyncIterable<SDKUserMessage>` prompt.
- The voice tail.
- The deep self-review pass.
- The deep → main fallback.
- Session resume.
- Mapping SDK error subtypes into `describeFailure`. Today they surface as `error_max_turns: …` text.

## Next steps

1. **On the Windows PC:** run `npm install`, set `ORBIT_CORE_ENGINE=sdk`, and ask *"what are my goals?"* and *"news about Estonia today"*. The trace should read `subscription login` and show the tool rows.
2. Port the remaining tools as zod shapes, each through `gated()`. Delete the JSON-envelope prompt once all of them run on the SDK.
3. Add session resume per chat (`resume`, with `persistSession` on and a fixed `cwd`), and `startup()` pre-warm.
4. Add images, voice, deep effort with review, and fallback. Then switch the default.
