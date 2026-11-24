import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { GET as tasksGET } from "../tasks/route";
import { GET as proposalsGET } from "../proposals/route";
import { GET as usageGET } from "../usage-meter/route";
import { ensureDirs, listJobs, startClipQueue } from "@/lib/clips/factory";
import { shownJobs } from "@/lib/clips/pure";
import { studioSummary } from "@/lib/mission-pure";

export const dynamic = "force-dynamic";

const part = (r: Promise<Response>) => r.then((x) => (x.ok ? x.json() : null), () => null); // as the client's get(): null on any failure

/** Mission Control in one request (efficiency pass 2): the four API reads and the events query it used to make every 5 s.
 *  Each part is exactly what its own route returns (studio: only the fields bridgeStudio reads), null when that part failed.
 *  ORBIT_MISSION_COMBINED=0 → {off: true}: the client goes back to its separate requests. */
async function GET_(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  if (process.env.ORBIT_MISSION_COMBINED === "0") return Response.json({ off: true });
  const studio = (async () => { startClipQueue(); await ensureDirs(); return studioSummary(shownJobs(await listJobs({ shared: true }))); })().catch(() => null);
  const [tasks, proposals, usage, s, events] = await Promise.all([
    part(tasksGET(new Request(new URL("/api/tasks", req.url)))), part(proposalsGET()), part(usageGET()), studio,
    Promise.resolve(sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(14)).then((r) => r.data ?? null, () => null),
  ]);
  return Response.json({ tasks, proposals, usage, studio: s, events });
}
export const GET = guard("mission", GET_);
