import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { ackReminder, addHabit, addReminder, checkHabit, getDue, getLife, logFocus, markFired, removeHabit, removeReminder, saveJournal, setHabitNudge, setHabitPlan, setLiveFocus } from "@/lib/life";
import { getWeekReview } from "@/lib/life-week";
import { takeHabitToasts } from "@/lib/habit-nudge";
import { restoreFocusTimer } from "@/lib/focus-timer-pure";
import { MAX_FOCUS_MIN, habitPlanPatch, isRepeat } from "@/lib/life-pure";

export const dynamic = "force-dynamic";

// LIFE workspace. GET → full state (?due=1 → { due } reminders whose time has come and that haven't fired).
// addReminder takes optional repeat: daily|weekdays|weekly.
// POST { action: addHabit|removeHabit|check|nudge|habitPlan|addReminder|removeReminder|fired|focus|timer|journal, ... }.
// ?week=1 → the weekly review (LIF08, local data only, never the journal).
// ?due=1 also drains in-app habit nudges ({ habits }) from habit-nudge.ts.

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("week") === "1") return Response.json(await getWeekReview());
  if (new URL(req.url).searchParams.get("due") === "1") return Response.json({ due: await getDue(), habits: takeHabitToasts() });
  return Response.json(await getLife());
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const bad = (error: string) => Response.json({ error }, { status: 400 });
const out = (r: object) => ("error" in r ? Response.json(r, { status: 400 }) : Response.json(r));

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  const id = str(b.id, 80);
  const date = b.date === undefined ? undefined : str(b.date, 10);
  if (date === null) return bad("Invalid date");
  switch (b.action) {
    case "addHabit": {
      const name = str(b.name, 200), emoji = b.emoji === undefined ? undefined : str(b.emoji, 16);
      if (name === null || emoji === null) return bad("Invalid name or emoji");
      if (b.days !== undefined && !Array.isArray(b.days)) return bad("Invalid days");
      return out(await addHabit(name, emoji, b.days));
    }
    case "removeHabit":
      return id ? Response.json({ removed: await removeHabit(id) }) : bad("Missing id");
    case "check": {
      const q = id ?? str(b.name, 80);
      if (!q || (b.done !== undefined && typeof b.done !== "boolean")) return bad("Missing habit or invalid done");
      if (b.amount !== undefined && !(typeof b.amount === "number" && b.amount >= 0 && b.amount <= 100_000)) return bad("Amount must be 0–100000");
      return out(await checkHabit(q, b.done ?? true, date, b.amount));
    }
    case "nudge": {
      const when = str(b.when ?? "", 60), channel = str(b.channel, 10);
      if (!id || when === null || channel === null) return bad("Missing id, when or channel");
      return out(await setHabitNudge(id, when, channel));
    }
    case "habitPlan": {
      const p = habitPlanPatch(b);
      if (!id || typeof p === "string") return bad(typeof p === "string" ? p : "Missing id");
      return out(await setHabitPlan(id, p));
    }
    case "addReminder": {
      const text = str(b.text, 200), at = str(b.at, 40);
      if (text === null || at === null) return bad("Invalid text or time");
      if (b.repeat !== undefined && b.repeat !== null && !isRepeat(b.repeat)) return bad("Repeat must be daily, weekdays or weekly");
      return out(await addReminder(text, at, b.repeat ?? undefined));
    }
    case "removeReminder":
      return id ? Response.json({ removed: await removeReminder(id) }) : bad("Missing id");
    case "fired":
      if (!id) return bad("Missing id");
      { const notice = await markFired(id); return Response.json({ ok: !!notice, notice }); }
    case "ack":
      return id ? Response.json({ ok: await ackReminder(id) }) : bad("Missing id");
    case "focus": {
      const m = b.minutes;
      if (!Number.isInteger(m) || m < 1 || m > MAX_FOCUS_MIN) return bad(`Minutes must be 1–${MAX_FOCUS_MIN}`);
      const task = b.task === undefined ? undefined : str(b.task, 120);
      if (task === null) return bad("Invalid task");
      const today = await logFocus(m, task?.trim() || undefined);
      await emit(sb, user.id, "focus.session", "life", { minutes: m });
      return Response.json({ today });
    }
    case "timer": // the PC's live focus timer, for /screen; anything invalid becomes a paused timer
      await setLiveFocus(restoreFocusTimer(JSON.stringify(b.timer ?? null), Date.now()).timer);
      return Response.json({ ok: true });
    case "journal": {
      const text = str(b.text, 2000);
      if (text === null) return bad("Journal entry must be at most 2000 characters");
      return out(await saveJournal(text, date));
    }
    default:
      return bad("Unknown action");
  }
}
