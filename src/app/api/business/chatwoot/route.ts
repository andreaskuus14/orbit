import { addChat } from "@/lib/complaints";
import { chatwootSecretOk, chatwootSignatureOk, parseChatwootEvent } from "@/lib/complaints-pure";

export const dynamic = "force-dynamic";

// Public webhook for a self-hosted Chatwoot (docs/PC-CHECKLIST.md). Chatwoot signs each call (X-Chatwoot-Signature over timestamp + body,
// 5 min replay window). Older Chatwoot builds without signing fall back to ?secret= / x-chatwoot-secret. Nothing is ever sent from here.
const MAX_BODY = 64 * 1024;
const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail("Request too large", 413);
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return fail("Request too large", 413);
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET, sig = req.headers.get("x-chatwoot-signature");
  const ok = sig ? chatwootSignatureOk(secret, req.headers.get("x-chatwoot-timestamp"), sig, raw)
    : chatwootSecretOk(secret, req.headers.get("x-chatwoot-secret") ?? new URL(req.url).searchParams.get("secret"));
  if (!ok) return fail("Refused", 401);
  let j: unknown = null;
  try { j = JSON.parse(raw); } catch { return fail("Body must be JSON", 400); }
  const m = parseChatwootEvent(j);
  if (!m) return Response.json({ ok: true, ignored: true });
  // Answer Chatwoot at once; the draft is written in the background and waits for the owner.
  void addChat(m).catch((e) => console.warn("[chatwoot] draft failed:", e instanceof Error ? e.message : e));
  return Response.json({ ok: true });
}
