import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { orbitDataDir } from "@/lib/data-dir";
import { BusyError, FAST_MODEL, askClaude, recordUsage } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { DRAFT_SYSTEM, cleanDraft, draftPrompt, emptyPortfolio, parseDraftInput, parsePortfolio } from "@/lib/portfolio-pure";

export const dynamic = "force-dynamic";

// Portfolio builder. GET → {portfolio}; PUT {portfolio} saves it to the local data folder (pictures included);
// POST {project} → {text}: one fast-model draft of that project's text, only on his click. Nothing is published from here.
// CSRF: src/middleware.ts (all /api writes).
const FILE = () => path.join(orbitDataDir(), "portfolio.json");
const MAX_BODY = 60_000_000; // ~250 JPEG captures; a bigger save is refused (413), never cut short
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json({ portfolio: parsePortfolio(JSON.parse(await readFile(FILE(), "utf8"))) }); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ portfolio: emptyPortfolio() });
    return fail("portfolio.json is unreadable; it was left as it is", 500); // never overwrite a broken file with an empty one silently
  }
}

export async function PUT(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail("Portfolio too big to save: remove some pictures", 413);
  const b = await req.json().catch(() => null) as { portfolio?: unknown } | null;
  if (!b?.portfolio) return fail("Missing portfolio");
  const p = parsePortfolio(b.portfolio);
  await mkdir(path.dirname(FILE()), { recursive: true });
  await writeFile(FILE() + ".tmp", JSON.stringify(p));
  await rename(FILE() + ".tmp", FILE());
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null) as { project?: unknown } | null;
  const d = parseDraftInput(b?.project); // titles, captions and his notes only: pictures never go to the model
  if (!d) return fail("Give the project a title first");
  const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
  if (held) return fail(`Not right now: ${held}`, 503);
  try {
    const r = await askClaude(draftPrompt(d), DRAFT_SYSTEM,
      { lane: "foreground", model: FAST_MODEL, purpose: "portfolio.draft", timeoutMs: 60_000, signal: req.signal });
    await recordUsage(sb, user.id, "portfolio.draft", r, FAST_MODEL);
    const text = cleanDraft(r.text);
    return text ? Response.json({ text }) : fail("No draft came back; try again", 502);
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't draft: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
