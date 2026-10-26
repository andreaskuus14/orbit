# CORE capability: how CORE talks to Claude, and where capability was lost

Roadmap §1.1–1.6, batch items 1–3. Line numbers are as of branch `core-capability`.

## The integration as it is

| Area | What it does | Evidence |
|---|---|---|
| Auth | Local Claude Code CLI (`claude -p`) under the owner's Claude login. No API key and no per-token bill. If `ANTHROPIC_API_KEY` is set in ORBIT's env, the CLI bills that key instead (the DEV readout now shows this). | `src/lib/claude.ts:16-18` |
| Models | main `ORBIT_MODEL`=sonnet, fast `ORBIT_MODEL_FAST`=haiku, deep `ORBIT_MODEL_DEEP`=opus + `--effort` (`ORBIT_DEEP_EFFORT`=high), smart `ORBIT_MODEL_SMART`=opus (clips/niche, not CORE). The tier comes from `pickModel` (regex heuristics). | `claude.ts:19-29`, `core-ui.ts:15-23`, `core.ts:132,201` |
| Reasoning | Only the deep tier: `--effort`, a private "thought" plan, then one tool-less self-review pass. | `core.ts:188,241-251`, `claude.ts:277-289` |
| Output limits | No max-token flag. Per-call timeout 120 s (360 s for SMART), deep turn budget 270 s against the route's 300 s `maxDuration`. | `claude.ts:30,220`, `core.ts:7`, `app/api/core/route.ts:4` |
| Session | **Stateless.** Every step is a fresh `claude -p --no-session-persistence` process. History, memories and earlier tool results are re-sent as text in each prompt. Spare CLIs are pre-booted only to skip start-up time. | `claude.ts:122,144-182` |
| Tool loop | CORE's own JSON envelope (`{"tool":…}` / `{"final":…}`). CLI built-in tools are off (`--tools ""`), and `web_search` is a separate CLI call with WebSearch/WebFetch only. Tool-call ids don't exist: results come back as text `You called X … RESULT:`. | `core.ts:77-80,192-275`, `claude.ts:120-121` |
| History window | Last 8 messages in full; older ones as ≤32 sampled 160-char excerpts. Chats cap at 400 messages. | `core.ts:167`, `core-context-pure.ts:17-27`, `core-chats-pure.ts:5` |
| Prompt layers | System rules + tool list + module prompt + profile; per-turn NOW, memories, chat summaries, facts/lessons/episodes, world model, module status, playbook style, persona, project, attachments, then the voice/deep tail. | `core.ts:51-93,140-176,197` |
| Concurrency | 3 CLIs at once, foreground lane first; agents get 8 min / 12 calls per task tree. | `claude.ts:37,75` |

## Where capability was lost

1. **Low tool-step cap.** `MAX_STEPS = 5` meant at most 4 tool calls per turn, and the 5th step was forced to answer. Multi-step tasks stopped half-way. (`core.ts:48` before)
2. **Voice brevity limited the work.** On-screen voice told the model to "answer in 1-3 short sentences" (the whole answer, not just the spoken part), and voice turns were downgraded from deep to main. (`core.ts:133,196` before)
3. **The weaker model was used without the user being told.** Deep → main on a failure or time limit was only a `fallback` trace row. The answer itself didn't say so. (`core.ts:199,228`)
4. **Failures were not named plainly.** An expired login, a usage limit or a timeout reached the user as raw CLI text. A turn that ended on a tool call showed `(no answer)`. (`core-turn.ts:85-88`, `core.ts:288` before)
5. **No session continuity.** Each step and each message starts a fresh CLI with no Claude-side session, so nothing carries over except the text CORE re-sends. Cached prompt context is lost and the history window (item above) is what's left. *Not fixed here, see below.*
6. **Tool results truncated** to 8000 characters per step (and 140 chars in the visible trace). That's reasonable for prompt size, so it was left as is and is now shown in the readout. (`core.ts:271,274`)
7. **Review context cut** at 40k characters (tool results first). Left as is. (`claude.ts:279`)

## What this branch fixes

- **Step cap:** `ORBIT_CORE_MAX_STEPS`, default 8 (7 tools), clamped 2–12 (`core-capability-pure.ts maxSteps`, `core.ts:49`). The budget stays: any step after the first is forced to answer when less than 90 s of the 270 s turn is left (`core.ts:194`).
- **Voice vs depth:** with on-screen voice, only the first paragraph of the answer is spoken (`speech-text.ts sentenceStream(true)`, `panels.tsx:159,217`). The prompt asks for a 1-3 sentence summary first and the full result below it, which stays on screen (`core.ts:197`). On-screen voice keeps the deep tier. Phone calls (no screen) keep short replies and no deep tier (`core.ts:134`).
- **Fallback shown:** a deep → main fallback adds a visible note to the answer (`fallbackNote`, `core.ts:289`). fast → main is an upgrade and stays silent.
- **Honest failures:** `describeFailure` names a usage limit (with the reset time when one is given), an expired or missing login (tells him to run `claude` and `/login`), a timeout, or a missing CLI (`core-turn.ts:87`). A turn that runs out of steps says "CORE stopped after N tool calls without writing an answer" (`core.ts:289`). Tool errors were already passed back as `Error:` results and shown as failed trace rows.
- **DEV readout:** `GET /api/core` → `coreConfig()` (`src/lib/core-config.ts`). It's shown in the DEV world under the "⚙ CORE" tab (`CoreConfigPanel.tsx`) and lists: auth mode, CLI, every model, effort, steps, truncation, budgets, concurrency, history, session mode, tools and voice mode.

Approval and policy rules (`decide`, `policy-pure.ts`) are unchanged.

## Batch 2: sessions and per-module instructions

- **Opt-in session (`ORBIT_CORE_SESSION=resume`, default off).** Each CORE chat keeps one Claude CLI session id. Its first call uses `--session-id <uuid>`, later calls use `--resume <uuid>` (flags checked against the installed `claude --help`). Session calls all run in one fixed folder (`$TMP/orbit-core-sessions`) because the CLI files sessions by working directory. What is sent:
  - a new session gets the full prompt;
  - a resumed one gets it without the `CONVERSATION SO FAR` block;
  - steps after the first in a turn send only the new tool results (`sessionInput`).
  On any session error, that step is redone statelessly, the session is dropped, and the answer gets a visible note. The map lives in memory, so a server restart starts new sessions. Phone calls and agents stay stateless. Code: `claude.ts` (`CliSession`, `prepare`), `core.ts` (`coreSessions`, step loop), `core-turn.ts` (passes the chat id).
- **Per-module instructions (§1.4).** The system prompt now names the modules in one line. Each turn's prompt carries only the modules whose `MODULE_HINTS` keywords match the question or CORE's last reply (`selectModules` in `core-modules-pure.ts`). Modules without a hint always load. `decide()` and approvals are unchanged.

## Left to do

- **Agent SDK / session evaluation (roadmap 1.1, batch item 2):** CORE is a request-and-response wrapper with its own JSON tool loop. The next step is to try `@anthropic-ai/claude-agent-sdk` (or `claude -p --resume <session>` with `--output-format stream-json`), so tool calls get real ids and structured errors, the session survives across steps and follow-ups, and context management and prompt caching work. ORBIT's tools would be exposed as an in-process MCP server gated by `decide()`. First check that the SDK works with the subscription login on Windows.
- Module hints are keywords. An oddly worded request can miss its module, and the model then lacks that tool for the turn.
- Session mode is untested against a live, signed-in CLI here (none is signed in in this sandbox).
- "prepared / executed / verified" states (1.6) need the mission record (batch item 4).
- The readout repeats constants (8000 / 8 messages / 270 s) instead of importing them. Keep them in sync if they change.
