import { requireUser } from "@/lib/supabase/server";
import { cancelReaJob, readReaJob, readReaPage, reaEvidenceText, reaStatus, startReaJob } from "@/lib/rea";
import type { ReaView } from "@/lib/rea-pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "REA request failed" }, { status: 400, headers });

export async function GET(req: Request) {
  const { user, res } = await requireUser(); if (res) return res;
  try {
    const q = new URL(req.url).searchParams, id = q.get("job") ?? undefined;
    if (q.get("download") === "1") {
      if (!id) throw new Error("A job ID is required.");
      const text = await reaEvidenceText(user.id, id);
      return new Response(text, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="rea-${id}.json"` } });
    }
    if (q.has("view")) {
      const view = q.get("view")!;
      if (!["summary", "modules", "edges", "evidence"].includes(view)) throw new Error("Invalid evidence view.");
      const offset = Number(q.get("offset") ?? 0), query = q.get("query") ?? "";
      if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 200) throw new Error("Invalid page offset or query.");
      return Response.json(await readReaPage(user.id, id, view as ReaView, offset, query), { headers });
    }
    return Response.json(id ? await readReaJob(user.id, id) : await reaStatus(user.id), { headers });
  } catch (e) { return fail(e); }
}
export async function POST(req: Request) {
  const { user, res } = await requireUser(); if (res) return res;
  try {
    const input = await req.json();
    if (!input || typeof input !== "object") throw new Error("Expected a JSON action.");
    if (input.action === "analyze") {
      if (input.target !== undefined && typeof input.target !== "string") throw new Error("target must be a registered name.");
      return Response.json(await startReaJob(user.id, input.target), { status: 202, headers });
    }
    if (input.action === "cancel") {
      if (input.job !== undefined && typeof input.job !== "string") throw new Error("job must be a job ID.");
      return Response.json(await cancelReaJob(user.id, input.job), { headers });
    }
    throw new Error("Expected action analyze or cancel.");
  } catch (e) { return fail(e); }
}
