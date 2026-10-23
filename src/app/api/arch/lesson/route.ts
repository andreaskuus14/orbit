import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { LESSON_SYSTEM, lessonPrompt, parseLesson } from "@/lib/arch-lesson-pure";

export const dynamic = "force-dynamic";

// ARCH lessons: POST {topic: "Villa Savoye"} → {lesson}. Chapters carry ARCH ops; the client builds the model from them.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/lesson", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { topic?: unknown } | null;
  const topic = typeof b?.topic === "string" ? b.topic.trim() : "";
  if (!topic) return fail("Name a building to learn about");
  const held = stopAllOn() ? "Stop-all is on" : usageHold();
  if (held) return fail(`Not right now: ${held}`, 503);
  try {
    const r = await askClaude(lessonPrompt(topic), LESSON_SYSTEM, { lane: "foreground", purpose: "arch.lesson", timeoutMs: 150_000, signal: req.signal });
    const lesson = parseLesson(r.text);
    return lesson ? Response.json({ lesson }) : fail("CORE couldn't write that lesson; try another building", 502);
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't write the lesson: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
