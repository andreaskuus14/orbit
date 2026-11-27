// ORBIT 2 engine: runs @anthropic-ai/claude-agent-sdk query() with cwd = C:\Users\andre\orbit-config
// so ORBIT 2's CLAUDE.md, .claude/settings.json (permissions + guard.py hook), skills and MCP servers apply.
// Auth uses Andreas's existing Claude Code login on this machine (no API key handling).
import {
  createOrbit2StreamMapper,
  DEFAULT_ORBIT2_CWD,
  DEFAULT_ORBIT2_MODEL,
  ORBIT2_SETTING_SOURCES,
  resolveOrbit2Model,
  type Orbit2StreamEvent,
  type Orbit2TraceRow,
  type RawSdkMessage,
} from "./orbit2-pure.ts";

export const ORBIT2_CWD = (process.env.ORBIT2_CWD || DEFAULT_ORBIT2_CWD).trim();
export const ORBIT2_MODEL = resolveOrbit2Model(DEFAULT_ORBIT2_MODEL);

const liveControllers = () =>
  ((globalThis as { __orbit2LiveTurns?: Set<AbortController> }).__orbit2LiveTurns ??= new Set());

/** Stop-all: abort every live ORBIT 2 query immediately. */
export function abortOrbit2Turns(): number {
  const set = liveControllers();
  const count = set.size;
  for (const ac of set) ac.abort();
  return count;
}

export type Orbit2RunOptions = {
  prompt: string;
  sessionId?: string | null;
  systemAppend?: string;
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: (ev: Orbit2StreamEvent) => void;
};

export type Orbit2RunResult = {
  text: string;
  sessionId: string;
  model: string;
  trace: Orbit2TraceRow[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

export function orbit2Info() {
  return {
    engine: "orbit2",
    model: ORBIT2_MODEL,
    cwd: ORBIT2_CWD,
    settingSources: [...ORBIT2_SETTING_SOURCES],
    permissionMode: "dontAsk",
  };
}

/** Run one ORBIT 2 turn through @anthropic-ai/claude-agent-sdk and stream events via onEvent. */
export async function runOrbit2(opts: Orbit2RunOptions): Promise<Orbit2RunResult> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");

  const model = resolveOrbit2Model(ORBIT2_MODEL);
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.signal?.aborted) abortController.abort();

  liveControllers().add(abortController);
  const started = Date.now();
  const mapper = createOrbit2StreamMapper();

  let inputTokens = 0;
  let outputTokens = 0;
  let errorMsg: string | null = null;
  let sawResult = false;

  const sessionOpt =
    opts.sessionId && /^[0-9a-f-]{8,80}$/i.test(opts.sessionId)
      ? { resume: opts.sessionId, persistSession: true }
      : { persistSession: true };

  const queryOptions = {
    cwd: ORBIT2_CWD,
    model,
    settingSources: [...ORBIT2_SETTING_SOURCES],
    permissionMode: "dontAsk" as const,
    permissionPrompts: "none" as const,
    includePartialMessages: true,
    abortController,
    ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}),
    ...(opts.systemAppend
      ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: opts.systemAppend } }
      : {}),
    ...sessionOpt,
  };

  try {
    for await (const raw of query({ prompt, options: queryOptions as never })) {
      const m = raw as unknown as RawSdkMessage;
      if (m.type === "result") {
        sawResult = true;
        inputTokens = (m.usage?.input_tokens ?? 0) + (m.usage?.cache_creation_input_tokens ?? 0);
        outputTokens = m.usage?.output_tokens ?? 0;
      }
      const events = mapper.push(m);
      for (const ev of events) {
        if (ev.type === "error") errorMsg = ev.error;
        opts.onEvent?.(ev);
      }
    }
    if (errorMsg) throw new Error(errorMsg);
    if (!sawResult && !abortController.signal.aborted) {
      const fallbackText = mapper.getAnswer();
      if (fallbackText) {
        opts.onEvent?.({
          type: "done",
          conversationId: mapper.getSessionId(),
          sessionId: mapper.getSessionId(),
          answer: fallbackText,
          model: mapper.getModel(),
          engine: "orbit2",
          trace: mapper.getTrace(),
        });
      }
    }
    return {
      text: mapper.getAnswer(),
      sessionId: mapper.getSessionId(),
      model: mapper.getModel(),
      trace: mapper.getTrace(),
      inputTokens,
      outputTokens,
      ms: Date.now() - started,
    };
  } finally {
    liveControllers().delete(abortController);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
