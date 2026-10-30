import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { readAna, updateAna } from "@/lib/analytics-store";
import { cleanCalibration, cleanExperiment, isoWeek, proposalFor, type Improvement } from "@/lib/analytics-improve-pure";

export const dynamic = "force-dynamic";

// ANALYTICS owner inputs. GET → { calibration, experiments, queued }. POST {action}: "calibrate" {manual, touch} |
// "experiment" {name, change, metric} | "endExperiment" {id, decision} | "queue" {item} (ANA08: one scoped proposal for OPERATIONS,
// at most once per item key; it runs only after he approves it there).
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await readAna()); } catch (e) { return bad((e as Error).message, 500); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  try {
    if (b.action === "calibrate") await updateAna((s) => { s.calibration = { ...cleanCalibration(b), at: new Date().toISOString() }; });
    else if (b.action === "experiment") {
      const e = cleanExperiment(b, randomUUID(), new Date().toISOString());
      if (typeof e === "string") return bad(e);
      await updateAna((s) => { s.experiments = [e, ...s.experiments].slice(0, 50); });
    } else if (b.action === "endExperiment") {
      if (!["keep", "revert", "inconclusive"].includes(b.decision)) return bad("Pick keep, revert or inconclusive");
      const err = await updateAna((s) => {
        const e = s.experiments.find((x) => x.id === b.id);
        if (!e || e.end) return "No running experiment with that id";
        const at = new Date().toISOString();
        Object.assign(e, { end: at, decision: b.decision, decidedAt: at });
        return null;
      });
      if (err) return bad(err, 409);
    } else if (b.action === "queue") {
      const i = b.item as Improvement;
      if (!i || typeof i.key !== "string" || !i.key.startsWith(`${isoWeek(new Date())}:`) || typeof i.title !== "string" || typeof i.objective !== "string" || typeof i.acceptance !== "string" || !Array.isArray(i.evidence))
        return bad("Not an item from this week's queue");
      if ((await readAna()).queued[i.key]) return bad("Already sent to OPERATIONS this week", 409);
      const p = proposalFor({ ...i, key: i.key.slice(0, 200), evidence: i.evidence.filter((x): x is string => typeof x === "string").slice(0, 20), units: Number(i.units) || 0 });
      const { error } = await sb.from("proposals").insert({ ...p, user_id: user.id });
      if (error) throw error;
      await updateAna((s) => { s.queued[i.key] = new Date().toISOString(); });
    } else return bad("Unknown action");
    return Response.json(await readAna());
  } catch (e) { return bad(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), 500); }
}
