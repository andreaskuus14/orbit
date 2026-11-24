import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, SMART_MODEL, askClaude } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { MAX_IMAGE_BYTES, sniff } from "@/lib/attach-pure";
import { str } from "@/lib/pure";
import { planFromReply, promptFor, systemFor, STUDIO_INPUTS, type StudioInput } from "@/lib/arch-sketch-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// ARCH studio: POST multipart {kind: sketch | photo | brief, file?: picture, note?: text} → {plan}. Runs only on the owner's click.
// The model reads the picture (or the brief) into rough data; arch-floorplan-pure squares it up, measures and checks it.
// Nothing is saved here: the plan lives in his browser until he builds the 3D model from it (which ARCH then autosaves).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/plan", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const form = await req.formData().catch(() => null);
  const kind = String(form?.get("kind") ?? "") as StudioInput;
  if (!STUDIO_INPUTS.includes(kind)) return fail("Pick sketch, photo or brief");
  const note = str(form?.get("note"), 1500) ?? "";
  let images: { type: string; data: Uint8Array }[] = [];
  if (kind !== "brief") {
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("Add a picture");
    if (file.size > MAX_IMAGE_BYTES) return fail("Picture too big (max 3.75 MB)", 413);
    const data = new Uint8Array(await file.arrayBuffer()), t = sniff(data, file.name);
    if (t?.kind !== "image") return fail("Use a JPEG, PNG or WebP picture", 415);
    images = [{ type: t.type, data }];
  } else if (note.trim().length < 3) return fail("Write a few words about the house");
  const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
  if (held) return fail(`Not right now: ${held}`, 503);
  try {
    // Opus: reading a hand sketch into coordinates is careful visual work (Haiku is only for simple summarise/classify jobs)
    const r = await askClaude(promptFor(kind, note), systemFor(kind), { lane: "foreground", purpose: "arch.plan", model: SMART_MODEL, images, timeoutMs: 150_000, signal: req.signal });
    const plan = planFromReply(kind, r.text);
    if (!plan) return fail(kind === "brief" ? "Couldn't turn that into rooms; name the rooms or the size" : "Couldn't read walls from that picture; try a sharper, straight-on photo", 502);
    return Response.json({ plan });
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't read it: ${safeMessage(e, "unknown error")}`, 502);
  }
}
