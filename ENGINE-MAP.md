# ENGINE-MAP.md — Orbital UI → ORBIT 2 Engine Map

## 1. Where the Prompt Box Lives & Sends Requests

| Entry Point | File | Current (Old) Flow | New ORBIT 2 Flow |
|---|---|---|---|
| Galaxy Home prompt box ("What do you need?") | `src/components/home/CommandBar.tsx` → `src/components/Orbit.tsx` (`runCommand`) | Local nav/recipe/follow commands handled client-side; `ask` mode on home opens `HomeAnswer` (`src/components/motion/HomeAnswer.tsx`), which `POST`s to `/api/core?stream=1`. Otherwise opens `CorePanel`. | Same UI shell; `HomeAnswer` `POST`s directly to `/api/orbit2` and streams live tool steps + final answer. |
| "Hey ORBIT" voice prompt | `src/components/voice/useVoiceInput.ts`, `useWakeWord.ts`, `Orbit.tsx` (`VOICE_ASK` listener) | Dispatches `VOICE_ASK` → sets `pending` → opens `CorePanel` (`src/components/CoreChat.tsx`), which `POST`s to `/api/core?stream=1`. | Opens `CorePanel`, which `POST`s directly to `/api/orbit2`. |
| CORE chat drawer & `/chat` phone PWA | `src/components/CoreChat.tsx`, `src/components/ChatApp.tsx` | `POST /api/core?stream=1` with NDJSON stream (`start`, `step`, `step_done`, `delta`, `reset`, `done`, `error`). Live steps rendered by `CoreActivity.tsx`. | `POST /api/orbit2` with NDJSON stream (`start`, `step`, `step_done`, `delta`, `reset`, `done`, `error`). Reuses `CoreActivity.tsx` to render ORBIT 2 tool steps + denials + final answer. |
| Remote / Shortcuts / Desk voice callers | `src/app/api/remote/route.ts`, `src/app/api/remote/shortcut/route.ts`, `src/lib/call.ts` | Called `coreTurn()` (`src/lib/core-turn.ts`) and `runCore()`/`warmCore()` (`src/lib/core.ts`). | Calls ORBIT 2 (`runOrbit2()` / `streamOrbit2()`) directly via `src/lib/orbit2.ts`. |

## 2. Where the Old Engine Lived (Removed Completely — No Fallback)

### Old Engine API Routes (Deleted)
- `src/app/api/core/route.ts` — Old `POST /api/core` (`coreTurn`) and `GET /api/core` (`coreConfig`).
- `src/app/api/core/engine/route.ts` — Old `GET/POST /api/core/engine` switcher (`cli` / `mcp` / `sdk`).
- `src/app/api/core/allow-once/route.ts` — Old CORE policy allow-once approval route.
- `src/app/api/core/eval/route.ts` — Old nightly CORE exam route.
- `src/app/api/local-brain/route.ts` — Old Ollama local-brain status/autostart route.
- `src/app/api/devworld/local/route.ts` — Old DEV world Ollama local-brain health route.

### Old Engine Core & Model-Call Code (Deleted / Replaced)
- `src/lib/core-turn.ts` — Old CORE HTTP/NDJSON turn orchestrator, Supabase chat loop, background handoff.
- `src/lib/core.ts` — Old multi-step JSON/MCP/SDK CORE engine, reflex layer, and Ollama offline dispatch.
- `src/lib/core-engine.ts` — Old `ORBIT_CORE_ENGINE` / `core-engine.json` engine selector.
- `src/lib/core-config.ts` — Old CORE config readout for `ORBIT_MODEL*`, `ORBIT_CORE_SESSION`, `ORBIT_LOCAL_MODEL`.
- `src/lib/core-sdk.ts` & `src/lib/core-sdk-pure.ts` — Old isolated SDK prototype (`tools: []`, `settingSources: []`, in-process MCP tools).
- `src/lib/core-mcp.ts`, `src/lib/core-mcp-pure.ts`, `src/lib/core-mcp-boost.ts`, `src/lib/core-mcp-boost-pure.ts` — Old `claude -p` + local HTTP bridge MCP engine.
- `scripts/orbit-mcp.mjs` — Old stdio MCP bridge script for `core-mcp.ts`.
- `src/lib/offline-tools.ts` & `src/lib/offline-tools-pure.ts` — Old Ollama offline CORE turn fallback.
- `src/lib/orbit-exam.ts` — Old nightly exam runner calling `coreTurn`.
- `src/lib/claude.ts` — Removed all `claude -p` CLI spawning (`spawn`, `prepare`, `runClaudeStream`, `warmClaude`, `coolClaude`, `withLocal`, `withModelFailover`, `CLAUDE_BIN`, `ORBIT_MODEL*`, `ORBIT_DEEP_EFFORT`, `ORBIT_HAIKU_ROUTING`, `ORBIT_CLAUDE_CONCURRENCY`). Legacy server helpers (`askClaude`, `askClaudeStream`) now delegate exclusively to ORBIT 2 via `@anthropic-ai/claude-agent-sdk` (model `"opus"`, never Fable).

### Old Engine UI & Env Config (Removed)
- `src/components/CoreEngineSection.tsx` (removed from `src/components/panels.tsx`).
- `src/components/CoreConfigPanel.tsx` (removed from `src/components/DevWorld.tsx`).
- `src/components/OrbitExamCard.tsx`.
- `src/components/AllowOnceCard.tsx` (removed from `src/components/CoreChat.tsx`).
- Removed old engine env vars from `.env.example` and runtime code (`ORBIT_MODEL`, `ORBIT_MODEL_SMART`, `ORBIT_MODEL_FAST`, `ORBIT_MODEL_DEEP`, `ORBIT_DEEP_EFFORT`, `ORBIT_CLAUDE_BIN`, `ORBIT_CLAUDE_CONCURRENCY`, `ORBIT_HAIKU_ROUTING`, `ORBIT_CORE_ENGINE`, `ORBIT_CORE_SESSION`, `ORBIT_CORE_MAX_STEPS`, `ORBIT_MODEL_VERIFY`).
- Removed unused direct dependency `zod` from `package.json` (only imported by deleted `src/lib/core-sdk.ts`).

## 3. New ORBIT 2 Engine Architecture

- **`src/lib/orbit2-pure.ts`**: Pure mapping from Claude Agent SDK stream messages (`system:init`, `stream_event`, `assistant` tool_use blocks, `user` tool_result blocks, `system:permission_denied`, `tool_progress`, `result`) into Orbital's NDJSON live step & text delta protocol, plus human-friendly tool labels and a hard guard blocking the Fable model.
- **`src/lib/orbit2.ts`**: Runs `@anthropic-ai/claude-agent-sdk` `query()` with:
  - `cwd: process.env.ORBIT2_CWD || "C:\\Users\\andre\\orbit-config"` (loads ORBIT 2's `CLAUDE.md`, `.claude/settings.json` permissions & `guard.py` `PreToolUse` hook, skills, and MCP servers)
  - `settingSources: ["user", "project"]`
  - `model: "opus"` (never Fable)
  - `permissionMode: "dontAsk"` and `permissionPrompts: "none"` (honors `.claude/settings.json` `allow` / `deny` / `ask` + `guard.py` hook; denies gated/unapproved actions without hanging or auto-approving)
  - `includePartialMessages: true`
  - Uses Andreas's existing Claude Code login on this machine (no API key handling).
  - Supports conversation continuity via SDK `resume: sessionId`.
- **`src/app/api/orbit2/route.ts`**:
  - `POST /api/orbit2` — Streams NDJSON events (`start`, `step`, `step_done`, `delta`, `reset`, `done`, `error`) back to `HomeAnswer` and `CoreChat`.
  - `GET /api/orbit2` — Returns non-sensitive ORBIT 2 runtime info (engine, model, cwd, settingSources).
- **Local no-Supabase mode**: When running locally on `127.0.0.1` / `localhost` without Supabase credentials configured, `middleware.ts`, `src/app/page.tsx`, and `src/lib/supabase/client.ts` gracefully allow the local Orbital shell to boot and talk directly to `/api/orbit2`.
