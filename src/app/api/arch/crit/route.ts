import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { createMemory } from "@/lib/memory";
import { MAX_IMAGE_BYTES, sniff } from "@/lib/attach-pure";
import { str } from "@/lib/pure";
import type { PriceItem, Scene } from "@/lib/arch-pure";
import { CRIT_SYSTEM, REPLY_SYSTEM, canReply, critFacts, critNote, critPrompt, parseCrit, replyPrompt, sceneVersion, withReply } from "@/lib/arch-crit-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// ARCH studio crit (roadmap 4), owner's click only. POST multipart {scene, prices (JSON), shot? (JPEG of the 3D view)} → {crit, facts,
// version, memoryId}: facts computed here, ONE model call. POST JSON {id, reply} → one follow-up answer appended to that crit.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const held = () => (stopAllOn() ? "Stop-all is on" : usageHardHold());
const busy = (e: unknown, what: string) => (e instanceof BusyError ? fail("CORE is busy; try again in a moment", 429) : fail(`Couldn't ${what}: ${e instanceof Error ? e.message : "unknown error"}`, 502));

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/crit", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  if (h.get("content-type")?.includes("application/json")) return reply(req, sb!);

  const form = await req.formData().catch(() => null);
  let scene: Scene, prices: PriceItem[];
  try {
    const raw = String(form?.get("scene") ?? "");
    if (raw.length > 20_000) return fail("Scene too big");
    scene = JSON.parse(raw); prices = JSON.parse(String(form?.get("prices") ?? "[]"));
    if (!Array.isArray(scene?.parts) || !Array.isArray(prices)) throw new Error();
  } catch { return fail("Scene missing"); }
  const shot = form?.get("shot");
  let image: { type: string; data: Uint8Array } | null = null;
  if (shot instanceof File && shot.size <= MAX_IMAGE_BYTES) {
    const data = new Uint8Array(await shot.arrayBuffer()), kind = sniff(data, "view.jpg");
    if (kind?.kind === "image") image = { type: kind.type, data };
  }
  const why = held();
  if (why) return fail(`Not right now: ${why}`, 503);

  const facts = critFacts(scene, prices), version = sceneVersion(scene);
  let crit;
  try {
    const r = await askClaude(critPrompt(facts, !!image), CRIT_SYSTEM, { lane: "foreground", purpose: "arch.crit", images: image ? [image] : [], timeoutMs: 150_000, signal: req.signal });
    crit = parseCrit(r.text, facts);
  } catch (e) { return busy(e, "crit"); }
  if (!crit) return fail("CORE's crit came back in the wrong shape; try again", 502);
  const note = critNote(crit, facts, version, !!image);
  try {
    const out = await createMemory(sb, user.id, { kind: "note", ...note, source: "arch.crit" });
    return Response.json({ crit, facts, version, memoryId: out.memory.id, content: note.content });
  } catch (e) {
    return Response.json({ crit, facts, version, memoryId: null, content: note.content, saveError: e instanceof Error ? e.message : "Could not save" });
  }
}

async function reply(req: Request, sb: NonNullable<Awaited<ReturnType<typeof requireUser>>["sb"]>) {
  const b = (await req.json().catch(() => null)) as { id?: unknown; reply?: unknown } | null;
  const text = str(b?.reply, 1500, 1), id = typeof b?.id === "string" ? b.id : "";
  if (!text || !id) return fail("Write a reply");
  const { data: row } = await sb.from("memories").select("content, tags").eq("id", id).maybeSingle();
  if (!row || !(row.tags ?? []).includes("crit")) return fail("Crit not found", 404);
  if (!canReply(row.content)) return fail("This crit already has its follow-up; run a new crit on the next version", 409);
  const why = held();
  if (why) return fail(`Not right now: ${why}`, 503);
  let answer;
  try { answer = (await askClaude(replyPrompt(row.content, text), REPLY_SYSTEM, { lane: "foreground", purpose: "arch.crit.reply", timeoutMs: 90_000, signal: req.signal })).text.trim().slice(0, 2000); }
  catch (e) { return busy(e, "answer"); }
  if (!answer) return fail("No answer came back; try again", 502);
  // shortcut: the embedding isn't refreshed for the appended follow-up; switch to the PATCH path's re-embed if search misses replies
  const content = withReply(row.content, text, answer);
  const { error } = await sb.from("memories").update({ content }).eq("id", id);
  return Response.json({ answer, content, saveError: error?.message });
}
