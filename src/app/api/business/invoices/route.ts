import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { approveReminder, changeStatus, createFrom, deleteDraft, draftReminder, dropReminder, editDraft, invoicesView, makeStripeLink, refundInvoice, savePayLink, pdfOf, saveSeller } from "@/lib/invoices";

export const dynamic = "force-dynamic";

// Invoices (roadmap B6; logic: invoices-pure.ts, IO: invoices.ts). GET → {seller, invoices, dashboard, today}; GET ?pdf=<id> → the PDF.
// POST {action:"seller", ...details} | {action:"create", from:"prospect"|"negotiation", id} | {action:"edit", id, buyer?, lines?, vatOn?, vatRate?, issued?, due?, notes?}
// | {action:"status", id, to:"sent"|"paid"|"draft", paidOn?} | {action:"refund", id, amount, day?, note?} | {action:"unrefund", id} | {action:"delete", id} | {action:"remind", id, lang} | {action:"drop", id} | {action:"approve", id, seen}
// | {action:"paylink", id, url} | {action:"stripelink", id} (his click: creates a Stripe Payment Link, needs STRIPE_SECRET_KEY).
// Nothing is sent except "approve", his click on a reminder draft he read.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: unknown) => (typeof r === "string" ? (r ? fail(r, r === "Not found" ? 404 : 400) : Response.json({ ok: true })) : Response.json({ result: r }));
/** [result, warning]: a switch-off that failed reaches him as ok:false + warning, on success or refusal alike. */
const outWarn = ([r, warning]: [unknown, string]) => {
  if (!warning) return out(r);
  if (typeof r === "string" && r) return fail(`${r}. ${warning}`, r === "Not found" ? 404 : 400);
  return Response.json({ ...(typeof r === "string" ? {} : { result: r }), ok: false, warning });
};

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const pdf = new URL(req.url).searchParams.get("pdf");
  if (pdf) {
    const r = await pdfOf(pdf);
    if (typeof r === "string") return fail(r, r === "Not found" ? 404 : 409);
    return new Response(r.file.buffer as ArrayBuffer, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.name}"`, "cache-control": "no-store" } });
  }
  return Response.json(await invoicesView());
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/invoices", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    switch (b.action) {
      case "seller": return out(await saveSeller(b));
      case "create": return out(await createFrom(sb, user.id, b));
      case "edit": return outWarn(await editDraft(sb, user.id, b));
      case "status": return outWarn(await changeStatus(sb, user.id, b));
      case "delete": return outWarn(await deleteDraft(sb, user.id, b.id));
      case "refund": case "unrefund": return out(await refundInvoice(b));
      case "remind": return out(await draftReminder(b));
      case "drop": return out(await dropReminder(b.id));
      case "paylink": return outWarn(await savePayLink(sb, user.id, b));
      case "stripelink": return outWarn(await makeStripeLink(sb, user.id, b));
      case "approve": return approveReminder(sb, user.id, b.id, b.seen);
      default: return fail("action must be seller, create, edit, status, refund, unrefund, delete, remind, drop, paylink, stripelink or approve");
    }
  } catch (e) {
    return fail(`Couldn't do that: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
