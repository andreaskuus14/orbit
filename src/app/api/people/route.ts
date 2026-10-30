import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { CHECKIN_SYSTEM, checkinPrompt, validateLog, validatePerson, type PersonInput } from "@/lib/people-pure";
import { addPerson, deletePerson, editPerson, getPerson, listPeople, logContact, patchPerson, personTimeline } from "@/lib/people";

export const dynamic = "force-dynamic";

// People moons (MEMORY → People). Logic: src/lib/people-pure.ts, storage: src/lib/people.ts (local JSON only).
// GET → {people}; GET ?id= → {person, timeline}.
// POST {action:"add", ...fields} | {action:"keep", prospectId} (a BUSINESS contact becomes his own entry) | {action:"update", id, ...fields}
//   | {action:"log", id, note, at?} | {action:"delete", id} | {action:"checkin", id} (CORE drafts a check-in; saved as a draft only:
//   ORBIT never sends it, a business contact's message goes out only through BUSINESS's own approve & send).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (!id) return Response.json({ people: await listPeople(sb, user.id) });
    const t = await personTimeline(sb, user.id, id);
    return t ? Response.json(t) : fail("Not found", 404);
  } catch (e) { return fail(e instanceof Error ? e.message : "Could not load people", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/people", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  const found = (p: unknown) => (p ? Response.json({ person: p }) : fail("Not found", 404));
  try {
    if (b.action === "add") {
      const p = validatePerson(b, true);
      return typeof p === "string" ? fail(p) : Response.json({ person: await addPerson(p as PersonInput) });
    }
    if (b.action === "keep") {
      if (typeof b.prospectId !== "string") return fail("prospectId required");
      const t = await personTimeline(sb, user.id, `p:${b.prospectId}`);
      if (!t) return fail("Not found (or already kept)", 404);
      const { name, relation, notes } = t.person;
      return Response.json({ person: await addPerson({ name, relation, notes, affinity: "business", cares: "", next: "", importance: 3, remindDays: 21, prospectId: b.prospectId }) });
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return fail("id required");
    const id = b.id;
    switch (b.action) {
      case "update": {
        const p = validatePerson(b, false);
        return typeof p === "string" ? fail(p) : found(await patchPerson(id, p));
      }
      case "log": {
        const e = validateLog(b, Date.now());
        return typeof e === "string" ? fail(e) : found(await logContact(id, e));
      }
      case "delete": return (await deletePerson(id)) ? Response.json({ ok: true }) : fail("Not found", 404);
      case "checkin": {
        const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
        if (held) return fail(`Not drafting right now: ${held}`, 503);
        const p = await getPerson(id);
        if (!p) return fail("Not found", 404);
        const t = await personTimeline(sb, user.id, id);
        const r = await askClaude(checkinPrompt(p, t?.timeline ?? [], Date.now()), CHECKIN_SYSTEM, { lane: "foreground", purpose: "people.checkin", timeoutMs: 90_000, signal: req.signal });
        const draft = r.text.trim().slice(0, 2000);
        if (!draft) return fail("CORE returned an empty draft; try again", 502);
        return found(await editPerson(id, (x) => { x.draft = draft; }));
      }
      default: return fail("action must be add, keep, update, log, delete or checkin");
    }
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(e instanceof Error ? e.message : "Something went wrong", 500);
  }
}
