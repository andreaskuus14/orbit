import { addChat } from "@/lib/complaints";
import { chatwootSecretOk, parseChatwootEvent } from "@/lib/complaints-pure";

export const dynamic = "force-dynamic";

// Public webhook for a self-hosted Chatwoot (docs/PC-CHECKLIST.md). Chatwoot's webhook form only takes a URL, so the shared secret rides
// in ?secret= (or an x-chatwoot-secret header). Incoming customer messages are stored and drafted; nothing is ever sent from here.
const MAX_BODY = 64 * 1024;
const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const got = req.headers.get("x-chatwoot-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!chatwootSecretOk(process.env.CHATWOOT_WEBHOOK_SECRET, got)) return fail("Refused", 401);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail("Request too large", 413);
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return fail("Request too large", 413);
  let j: unknown = null;
  try { j = JSON.parse(raw); } catch { return fail("Body must be JSON", 400); }
  const m = parseChatwootEvent(j);
  if (!m) return Response.json({ ok: true, ignored: true });
  // Answer Chatwoot at once; the draft is written in the background and waits for the owner.
  void addChat(m).catch((e) => console.warn("[chatwoot] draft failed:", e instanceof Error ? e.message : e));
  return Response.json({ ok: true });
}
