import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { approvalGate, termContent } from "@/lib/approval-pure";
import { SHELLS, timeoutOf } from "@/lib/shell-session-pure";
import type { Shell } from "@/lib/command-policy-pure";

export const dynamic = "force-dynamic";

// OPERATIONS → Terminal. Every POST is the owner's own click or typed command (same levels as CORE's terminal_run).
//   GET                                           → { sessions, folders, dropped, privateCount, shell }
//   POST {action:"run", command, session?, shell?, cwd?}   → { run } (level 3 waits for "approve" like CORE's)
//   POST {action:"approve", id, approved}         → approved = contentHash(termContent(id, command, cwd)) of what he saw
//   POST {action:"skip"|"stop", id}   POST {action:"close", session}   POST {action:"undo", snapshot}
export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  const t = await import("@/lib/shell-session");
  const cfg = await t.termConfig(user.id);
  return Response.json({ sessions: t.listSessions(), folders: cfg.folders, dropped: cfg.dropped, shell: cfg.defaultShell });
}

type Body = { action?: string; command?: unknown; session?: unknown; shell?: unknown; cwd?: unknown; id?: unknown; approved?: unknown; snapshot?: unknown };
export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Body;
  const t = await import("@/lib/shell-session");
  const id = typeof b.id === "string" ? b.id : "";
  try {
    switch (b.action) {
      case "run": {
        const command = typeof b.command === "string" ? b.command : "";
        if (!command.trim()) return Response.json({ error: "Type a command" }, { status: 400 });
        const session = typeof b.session === "string" && /^[\w-]{1,24}$/.test(b.session) ? b.session.toLowerCase() : "main";
        const shell = (SHELLS as readonly string[]).includes(String(b.shell)) ? (b.shell as Shell) : undefined;
        const r = await t.submit({ userId: user.id, session, command, source: "owner", shell, cwd: typeof b.cwd === "string" && b.cwd.trim() ? b.cwd : undefined, timeoutS: timeoutOf(undefined) });
        return "error" in r ? Response.json({ error: r.error }, { status: 409 }) : Response.json({ run: r.run });
      }
      case "approve": {
        const s = t.listSessions().find((x) => x.runs.some((r) => r.id === id));
        const run = s?.runs.find((r) => r.id === id);
        if (!s || !run) return Response.json({ error: "That command is gone" }, { status: 404 });
        const gate = await approvalGate("terminal.approve", b.approved, termContent(run.id, run.command, s.cwd));
        if (gate) return Response.json({ error: gate }, { status: 409 });
        const r = await t.approveRun(id, s.cwd, run.command);
        return typeof r === "string" ? Response.json({ error: r }, { status: 409 }) : Response.json({ run: r });
      }
      case "skip": return Response.json({ ok: t.skipRun(id) });
      case "stop": return Response.json({ ok: t.stopRun(id) });
      case "close": return Response.json({ ok: typeof b.session === "string" && t.closeSession(b.session) });
      case "undo": {
        const snap = typeof b.snapshot === "string" ? b.snapshot : "";
        const title = await t.undoSnapshot(snap);
        logActivity({ area: "core", title, undid: `term:${snap}` });
        return Response.json({ ok: true, title });
      }
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: safeMessage(e, "Failed") }, { status: 500 });
  }
}
