import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError } from "@/lib/claude";
import { VaultError } from "@/lib/vault";
import { ContractError, addComment, createContract, editContract, listContracts, ownerStep, sendContract, setCover, signContract } from "@/lib/contracts";

export const dynamic = "force-dynamic";

// BUSINESS → Contracts (contracts.ts, local file; signed PDFs in VAULT). Every POST is the owner's own click in the PC drawer.
// POST {action:"create", template, title?, fields?, source?:{kind:"prospect"|"deal", id}, ai?} | {action:"edit", id, seen, fields?, clauses?}
//  | {action:"comment", id, text} | {action:"cover", id, text} | {action:"sign", id, seen, signature} | {action:"unsign"|"countersign"|"cancel", id, note?}
//  | {action:"send", id, seen}. ORBIT never signs: "sign" exists only behind his Sign button (no remote, voice or auto path calls it).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json({ contracts: await listContracts(), canSend: !!(process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM) }); }
  catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read contracts", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/contracts", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    switch (b.action) {
      case "create": return Response.json(await createContract(sb, user.id, b, req.signal));
      case "edit": return Response.json(await editContract(sb, user.id, b.id, b));
      case "comment": return Response.json(await addComment(b.id, b.text));
      case "cover": return Response.json(await setCover(b.id, b.text));
      case "sign": return Response.json(await signContract(sb, user.id, b.id, b.seen, b.signature));
      case "unsign": case "countersign": case "cancel": return Response.json(await ownerStep(sb, user.id, b.id, b.action, b.note));
      case "send": return Response.json(await sendContract(sb, user.id, b.id, b.seen));
      default: return fail("action must be create, edit, comment, cover, sign, unsign, send, countersign or cancel");
    }
  } catch (e) {
    if (e instanceof ContractError) return fail(e.message, e.status);
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    if (e instanceof VaultError) return fail(e.message, e.status); // saving the signed PDF: VAULT full, file too big
    return fail(`Couldn't do that: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
