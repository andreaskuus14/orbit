// Pure mapping and guards for the ORBIT 2 Agent SDK engine (no SDK import so node --test loads it directly).

export const DEFAULT_ORBIT2_CWD = "C:\\Users\\andre\\orbit-config";
export const DEFAULT_ORBIT2_MODEL = "opus";
export const ORBIT2_SETTING_SOURCES = ["user", "project"] as const;

export type Orbit2StepEvent = {
  type: "step";
  id: number;
  tool: string;
  label: string;
  detail?: string;
  t: number;
};

export type Orbit2StepDoneEvent = {
  type: "step_done";
  id: number;
  tool: string;
  ok: boolean;
  ms: number;
  result?: string;
  blocked?: boolean;
  t: number;
};

export type Orbit2TraceRow = {
  step: string;
  detail: string;
  ms: number;
  ok: boolean;
  blocked?: boolean;
};

export type Orbit2StreamEvent =
  | { type: "start"; conversationId: string; sessionId: string; model?: string; engine: "orbit2" }
  | Orbit2StepEvent
  | Orbit2StepDoneEvent
  | { type: "delta"; text: string }
  | { type: "reset" }
  | {
      type: "done";
      conversationId: string;
      sessionId: string;
      answer: string;
      model: string;
      engine: "orbit2";
      trace: Orbit2TraceRow[];
      permissionDenials?: { toolName: string; toolUseId: string }[];
    }
  | { type: "error"; conversationId?: string; error: string };

/** Hard rule: never use or configure the Fable model. */
export function resolveOrbit2Model(requested?: string | null): string {
  const m = (requested ?? "").trim() || DEFAULT_ORBIT2_MODEL;
  if (/fable/i.test(m)) {
    throw new Error("Fable model is forbidden in ORBIT 2; use 'opus' or 'claude-opus-5-5'.");
  }
  return m;
}

const clip = (s: string, n: number) => {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
};

/** Friendly UI label for an ORBIT 2 tool name (built-ins + MCP connectors). */
export function formatOrbit2ToolLabel(tool: string): string {
  if (/^mcp__claude_ai_Google_Calendar__/i.test(tool)) {
    const action = tool.replace(/^mcp__claude_ai_Google_Calendar__/i, "");
    if (/list_events/i.test(action)) return "Checking Google Calendar…";
    if (/list_calendars/i.test(action)) return "Listing Google Calendars…";
    return `Google Calendar (${action.replace(/_/g, " ")})…`;
  }
  if (/^mcp__claude_ai_Google_Drive__/i.test(tool)) return "Searching Google Drive…";
  if (/^mcp__claude_ai_Canva__/i.test(tool)) return "Using Canva…";
  if (/^mcp__claude_ai_Gmail__/i.test(tool)) return "Checking Gmail…";
  if (tool.startsWith("mcp__")) {
    const parts = tool.slice(5).split("__");
    const server = (parts[0] ?? "MCP").replace(/^claude_ai_/i, "").replace(/_/g, " ");
    const fn = (parts.slice(1).join(" ") || "tool").replace(/_/g, " ");
    return `${server}: ${fn}…`;
  }
  const map: Record<string, string> = {
    Read: "Reading file…",
    Write: "Writing file…",
    Edit: "Editing file…",
    MultiEdit: "Editing file…",
    Bash: "Running command…",
    Glob: "Finding files…",
    Grep: "Searching files…",
    WebSearch: "Searching the web…",
    WebFetch: "Reading web page…",
    Skill: "Running skill…",
    Agent: "Running subagent…",
    Task: "Running subagent…",
    TodoWrite: "Updating plan…",
    ToolSearch: "Loading tool…",
  };
  return map[tool] ?? `Using ${tool}…`;
}

/** Short, safe summary of a tool call's input for the live step row. */
export function formatOrbit2ToolDetail(tool: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== "object") return "";
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  if (tool === "Read" || tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    return clip(str("file_path") || str("path"), 80);
  }
  if (tool === "Bash") return clip(str("description") || str("command"), 70);
  if (tool === "WebSearch") return clip(str("query"), 80);
  if (tool === "WebFetch") {
    const u = str("url");
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return clip(u, 60); }
  }
  if (tool === "Glob" || tool === "Grep") return clip(str("pattern") || str("path"), 60);
  if (tool === "Skill") return clip(str("skill") || str("name"), 60);
  if (/Google_Calendar/i.test(tool)) {
    const min = str("timeMin").slice(0, 10);
    const max = str("timeMax").slice(0, 10);
    const q = str("q") || str("query");
    if (min && max) return `${min} → ${max}`;
    if (q) return clip(q, 60);
    return "";
  }
  const generic = str("query") || str("q") || str("path") || str("file_path") || str("url") || str("title");
  return generic ? clip(generic, 70) : "";
}

function extractTextContent(content: unknown): string {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => {
              if (typeof block === "string") return block;
              if (block && typeof block === "object" && "text" in block && typeof (block as { text?: unknown }).text === "string") {
                return (block as { text: string }).text;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
  return raw.replace(/<\/?tool_use_error>/g, "").trim();
}

export function isPermissionDenialText(text: string): boolean {
  return /\b(denied|blocked|permission|not allowed|refused|forbidden|guard\.py|ORBIT gate|Fable is blocked)\b/i.test(text);
}

const ERROR_WORDS: Record<string, string> = {
  rate_limit: "Claude usage limit reached. Try again later.",
  billing_error: "Claude billing or plan limit reached.",
  authentication_failed: "Claude Code authentication failed. Run `claude` to sign in.",
  oauth_org_not_allowed: "Claude organization not allowed for this login.",
  account_on_hold: "Claude account is on hold.",
};

export function formatOrbit2Error(code: string | undefined, errors: string[]): string {
  const mapped = code ? ERROR_WORDS[code] ?? code : "";
  const joined = [mapped, ...errors.filter(Boolean)].filter(Boolean).join(": ");
  return joined || "ORBIT 2 request failed";
}

type RawBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
};

export type RawSdkMessage = {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  apiKeySource?: string;
  parent_tool_use_id?: string | null;
  error?: string;
  tool_name?: string;
  tool_use_id?: string;
  decision_reason?: string;
  message?:
    | string
    | {
        content?: RawBlock[];
      };
  event?: {
    type?: string;
    content_block?: RawBlock;
    delta?: { type?: string; text?: unknown };
  };
  result?: unknown;
  is_error?: boolean;
  errors?: string[];
  permission_denials?: { tool_name?: string; tool_use_id?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  num_turns?: number;
};

/** Stateful stream reducer turning raw Claude Agent SDK messages into Orbital NDJSON events. */
export function createOrbit2StreamMapper(now = Date.now) {
  const t0 = now();
  let nextStepId = 0;
  let sessionId = "";
  let model = DEFAULT_ORBIT2_MODEL;
  let apiError: string | undefined;
  let streamedSinceReset = "";
  let finalAnswer = "";

  type OpenStep = { id: number; tool: string; label: string; detail: string; startedAt: number; deniedReason?: string };
  const byToolUseId = new Map<string, OpenStep>();
  const finished = new Set<string>();
  const trace: Orbit2TraceRow[] = [];

  const elapsed = () => Math.max(0, now() - t0);

  const openStep = (toolUseId: string, tool: string, input?: Record<string, unknown>): Orbit2StreamEvent[] => {
    const out: Orbit2StreamEvent[] = [];
    const existing = byToolUseId.get(toolUseId);
    const detail = formatOrbit2ToolDetail(tool, input);
    if (existing) {
      if (detail && detail !== existing.detail) {
        existing.detail = detail;
        out.push({ type: "step", id: existing.id, tool: existing.tool, label: existing.label, detail, t: elapsed() });
      }
      return out;
    }
    if (streamedSinceReset) {
      streamedSinceReset = "";
      out.push({ type: "reset" });
    }
    const id = ++nextStepId;
    const label = formatOrbit2ToolLabel(tool);
    byToolUseId.set(toolUseId, { id, tool, label, detail, startedAt: now() });
    out.push({ type: "step", id, tool, label, ...(detail && { detail }), t: elapsed() });
    return out;
  };

  const closeStep = (toolUseId: string, ok: boolean, blocked: boolean, resultText?: string): Orbit2StreamEvent[] => {
    if (finished.has(toolUseId)) return [];
    const s = byToolUseId.get(toolUseId);
    if (!s) return [];
    finished.add(toolUseId);
    const ms = Math.max(0, now() - s.startedAt);
    const note = resultText ? clip(resultText, 160) : s.deniedReason ? clip(s.deniedReason, 160) : undefined;
    trace.push({
      step: s.tool,
      detail: [s.detail, note].filter(Boolean).join(" → ") || s.label.replace(/…$/, ""),
      ms,
      ok: ok && !blocked,
      ...(blocked && { blocked: true }),
    });
    return [{
      type: "step_done",
      id: s.id,
      tool: s.tool,
      ok: ok && !blocked,
      ms,
      ...(note && { result: note }),
      ...(blocked && { blocked: true }),
      t: elapsed(),
    }];
  };

  return {
    getSessionId: () => sessionId,
    getModel: () => model,
    getTrace: () => trace,
    getAnswer: () => finalAnswer || streamedSinceReset,

    push(m: RawSdkMessage): Orbit2StreamEvent[] {
      const out: Orbit2StreamEvent[] = [];
      if (m.session_id && !sessionId) sessionId = m.session_id;

      if (m.type === "system" && m.subtype === "init") {
        if (m.session_id) sessionId = m.session_id;
        if (m.model) model = m.model;
        out.push({ type: "start", conversationId: sessionId, sessionId, model, engine: "orbit2" });
        return out;
      }

      if (m.type === "system" && m.subtype === "permission_denied") {
        const uid = m.tool_use_id ?? "";
        const tool = m.tool_name ?? "tool";
        const reason = (typeof m.message === "string" && m.message) || m.decision_reason || "Denied by ORBIT 2 permissions";
        if (uid) {
          out.push(...openStep(uid, tool));
          const step = byToolUseId.get(uid);
          if (step) step.deniedReason = reason;
          out.push(...closeStep(uid, false, true, reason));
        }
        return out;
      }

      if (m.type === "stream_event" && !m.parent_tool_use_id) {
        const ev = m.event;
        if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use" && ev.content_block.id && ev.content_block.name) {
          out.push(...openStep(ev.content_block.id, ev.content_block.name, ev.content_block.input));
        } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string" && ev.delta.text) {
          streamedSinceReset += ev.delta.text;
          out.push({ type: "delta", text: ev.delta.text });
        }
        return out;
      }

      if (m.type === "assistant" && !m.parent_tool_use_id) {
        if (m.error) apiError = m.error;
        const blocks = typeof m.message === "object" && m.message && Array.isArray(m.message.content) ? m.message.content : [];
        for (const b of blocks) {
          if (b.type === "tool_use" && b.id && b.name) {
            out.push(...openStep(b.id, b.name, b.input));
          }
        }
        return out;
      }

      if (m.type === "user" && !m.parent_tool_use_id) {
        const blocks = typeof m.message === "object" && m.message && Array.isArray(m.message.content) ? m.message.content : [];
        for (const b of blocks) {
          if (b.type === "tool_result" && b.tool_use_id) {
            const text = extractTextContent(b.content);
            const isErr = !!b.is_error;
            const s = byToolUseId.get(b.tool_use_id);
            const blocked = !!s?.deniedReason || (isErr && isPermissionDenialText(text));
            out.push(...closeStep(b.tool_use_id, !isErr, blocked, isErr || blocked ? text : undefined));
          }
        }
        return out;
      }

      if (m.type === "result") {
        // Close any still-open steps
        for (const [uid] of byToolUseId) {
          if (!finished.has(uid)) out.push(...closeStep(uid, true, false));
        }
        const denials = (m.permission_denials ?? []).map((d) => ({
          toolName: d.tool_name ?? "tool",
          toolUseId: d.tool_use_id ?? "",
        }));
        const resultText = typeof m.result === "string" ? m.result : "";
        const isErr = !!m.is_error || m.subtype !== "success";
        if (isErr) {
          out.push({
            type: "error",
            ...(sessionId && { conversationId: sessionId }),
            error: formatOrbit2Error(apiError, [m.subtype && m.subtype !== "success" ? m.subtype : "", ...(m.errors ?? []), resultText]),
          });
        } else {
          finalAnswer = (resultText || streamedSinceReset).trim();
          out.push({
            type: "done",
            conversationId: sessionId,
            sessionId,
            answer: finalAnswer,
            model,
            engine: "orbit2",
            trace,
            ...(denials.length > 0 && { permissionDenials: denials }),
          });
        }
        return out;
      }

      return out;
    },
  };
}
