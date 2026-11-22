// CORE answering on the galaxy home (ui-motion), pure: what the answer card shows for each /api/core stream event.
// Owner, 22 Nov: "it still puts me in chat, not like the demo". The approved motion test has the big orb thinking above the home
// input; the real Ask opened the CORE drawer, which hides that orb. Now a home Ask streams into a small card under the orb, and
// "Continue in chat" opens the same conversation in CORE. Tests: tests/home-answer.test.ts.

export type HomeAnswer = {
  q: string;
  phase: "thinking" | "tool" | "writing" | "done" | "error" | "handed";
  text: string;          // the answer so far (final answer once done)
  tool: string | null;   // the tool CORE is using now, as the stream labels it
  conversationId: string | null;
  taskId: string | null; // handed to a background task: it goes on in OPERATIONS
  error: string | null;
};
export type StreamEvent = { type: string; conversationId?: string; text?: string; answer?: string; label?: string; tool?: string; taskId?: string; error?: string };

export const startAnswer = (q: string, conversationId: string | null = null): HomeAnswer =>
  ({ q, phase: "thinking", text: "", tool: null, conversationId, taskId: null, error: null });

export function step(s: HomeAnswer, ev: StreamEvent): HomeAnswer {
  const conversationId = s.conversationId ?? ev.conversationId ?? null;
  switch (ev.type) {
    case "delta": return ev.text ? { ...s, conversationId, phase: "writing", tool: null, text: s.text + ev.text } : { ...s, conversationId };
    case "reset": return { ...s, conversationId, text: "", phase: "thinking" };
    case "step": return { ...s, conversationId, phase: s.text ? "writing" : "tool", tool: ev.label || ev.tool || s.tool };
    case "step_done": return { ...s, conversationId, phase: s.text ? "writing" : "thinking", tool: null };
    case "background": return { ...s, conversationId, phase: "handed", taskId: ev.taskId ?? s.taskId };
    case "bg_done": return { ...s, conversationId, phase: "done", text: ev.answer ?? s.text };
    case "done": return s.phase === "handed" ? { ...s, conversationId } : { ...s, conversationId, phase: "done", tool: null, text: ev.answer ?? s.text };
    case "error": return { ...s, conversationId, phase: "error", error: ev.error || "CORE failed" };
    default: return { ...s, conversationId };
  }
}

/** One line under the question while nothing is written yet. */
export function statusLine(s: HomeAnswer): string {
  if (s.phase === "tool" && s.tool) return s.tool;
  if (s.phase === "handed") return "Working on it in the background. It will show up in Jobs.";
  if (s.phase === "error") return s.error ?? "CORE failed";
  return s.phase === "thinking" ? "Thinking…" : "";
}

/** A long answer is shown shortened on home; the whole thing is one click away in chat. */
export const HOME_MAX = 700;
export function homeText(text: string): { text: string; cut: boolean } {
  if (text.length <= HOME_MAX) return { text, cut: false };
  const at = text.lastIndexOf("\n", HOME_MAX) > HOME_MAX * 0.6 ? text.lastIndexOf("\n", HOME_MAX) : text.lastIndexOf(" ", HOME_MAX);
  return { text: `${text.slice(0, at > 0 ? at : HOME_MAX).trimEnd()} …`, cut: true };
}
