import { requireUser } from "@/lib/supabase/server";
import { isCurrent } from "@/lib/memory-types-pure";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { createMemory } from "@/lib/memory";
import { MAX_IMAGE_BYTES, sniff } from "@/lib/attach-pure";
import { str } from "@/lib/pure";
import { CRITIQUE_SYSTEM, critiqueNote, critiquePrompt, parseCritique } from "@/lib/arch-studio-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// ARCH sketch critique (roadmap 5.3): POST multipart {file: photo of a sketch, brief?, lesson? (JSON {building, text}), lessonTag?}
// → {critique, memoryId}. Runs only on the owner's click; grounded in his brief, the open lesson and his saved ARCH lessons.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/critique", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Add a photo of the sketch");
  if (file.size > MAX_IMAGE_BYTES) return fail("Photo too big (max 3.75 MB)", 413);
  const data = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(data, file.name);
  if (kind?.kind !== "image") return fail("Use a JPEG, PNG or WebP photo", 415);
  const brief = str(form?.get("brief"), 2000) ?? "";
  let lesson: { building: string; text: string } | null = null;
  try { const l = JSON.parse(String(form?.get("lesson") ?? "null")); if (typeof l?.building === "string") lesson = { building: l.building.slice(0, 200), text: String(l.text ?? "").slice(0, 2000) }; } catch { /* no lesson */ }
  const tag = String(form?.get("lessonTag") ?? "");
  const lessonTagOk = /^lesson:[a-z0-9-]{1,28}$/.test(tag) ? tag : "";
  const held = stopAllOn() ? "Stop-all is on" : usageHold();
  if (held) return fail(`Not right now: ${held}`, 503);

  const { data: notes } = await sb.from("memories").select("kind, title, content, tags, created_at").contains("tags", ["arch", "lesson"]).order("created_at", { ascending: false }).limit(4);
  let critique;
  try {
    const r = await askClaude(critiquePrompt({ brief, lesson, notes: (notes ?? []).filter((m) => isCurrent(m, { now: Date.now() })) }), CRITIQUE_SYSTEM, { lane: "foreground", purpose: "arch.critique", images: [{ type: kind.type, data }], timeoutMs: 150_000, signal: req.signal });
    critique = parseCritique(r.text);
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't critique: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
  if (!critique) return fail("CORE couldn't read that sketch; try a sharper, well-lit photo", 502);

  // Keep the sketch with the note (same private bucket as MEMORY uploads); a storage failure still saves the critique.
  const name = file.name.replace(/[^\w.-]+/g, "_").slice(-120) || "sketch.jpg";
  const path = `${user.id}/${crypto.randomUUID()}-${name}`;
  const up = await sb.storage.from("vault").upload(path, data, { contentType: kind.type, upsert: false });
  const note = critiqueNote(critique, { file: file.name, brief, lesson: lessonTagOk });
  try {
    const out = await createMemory(sb, user.id, { kind: "note", ...note, source: "arch.critique", storage_path: up.error ? null : path });
    return Response.json({ critique, memoryId: out.memory.id, imageSaved: !up.error });
  } catch (e) {
    if (!up.error) await sb.storage.from("vault").remove([path]);
    return Response.json({ critique, memoryId: null, saveError: e instanceof Error ? e.message : "Could not save" });
  }
}
