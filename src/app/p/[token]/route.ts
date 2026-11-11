import { randomBytes } from "node:crypto";
import { openLink } from "@/lib/pitch-links";
import { viewerCsp, viewerHtml } from "@/lib/pitch-links-pure";

export const dynamic = "force-dynamic";

// Public, read-only pitch link (BUSINESS → Share link): renders one pinned contract/proposal version and logs the open.
// No session: the signed token is the key (pitch-links-pure tokenState). Bad, expired and revoked links all look the same.
type Ctx = { params: Promise<{ token: string }> };
const base = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  const r = await openLink(token, req.headers.get("user-agent"), req.headers.get("x-forwarded-for")).catch(() => ({ state: "bad" }));
  if ("state" in r) return new Response("This link isn't available.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...base } });
  const nonce = randomBytes(16).toString("base64");
  return new Response(viewerHtml(r.title, r.text, token, r.viewId, nonce), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": viewerCsp(nonce), ...base } });
}
