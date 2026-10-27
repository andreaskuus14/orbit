import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { MAX_RECEIPT } from "@/lib/money-pure";
import { addExpense, deleteExpense, moneyCsv, moneyView, receipt, saveSettings, saveVatPaid } from "@/lib/money";

export const dynamic = "force-dynamic";

// Money view (roadmap 3; logic: money-pure.ts, IO: money.ts). GET ?period=2026-10|2026-Q4|2026 → {pnl, settings, expenses, deadlines, today};
// GET ?csv=<period> → CSV for the accountant; GET ?receipt=<expense id> → the receipt file.
// POST multipart {action:"expense", day, category, amount, vatRate|vat, note, file?} | JSON {action:"settings", …} | {action:"vatPaid", month, amount} | {action:"delete", id}.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: unknown) => (typeof r === "string" ? (r ? fail(r, r === "Not found" ? 404 : 400) : Response.json({ ok: true })) : Response.json({ result: r }));

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  try {
    const rid = q.get("receipt");
    if (rid) {
      const r = await receipt(rid);
      if (!r) return fail("Not found", 404);
      return new Response(new Uint8Array(r.file), { headers: { "content-type": r.type, "content-disposition": `attachment; filename="${r.name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    const csv = q.get("csv");
    if (csv) {
      const text = await moneyCsv(csv);
      if (!text.startsWith("﻿")) return fail(text);
      return new Response(text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orbit-money-${csv.replace(/[^\w-]/g, "")}.csv"`, "cache-control": "no-store" } });
    }
    const v = await moneyView(q.get("period") ?? new Date().toISOString().slice(0, 7));
    return typeof v === "string" ? fail(v) : Response.json(v);
  } catch (e) {
    return fail(`Couldn't load the money view: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/money", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  try {
    if ((h.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const len = Number(h.get("content-length") ?? NaN);
      if (!Number.isSafeInteger(len) || len <= 0) return fail("Content-Length required", 411);
      if (len > MAX_RECEIPT + 64 * 1024) return fail("Receipt can be at most 10 MB", 413);
      const form = await req.formData().catch(() => null);
      if (!form || form.get("action") !== "expense") return fail("action must be expense");
      const b = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      const file = form.get("file");
      return out(await addExpense(b, file instanceof File ? file : null));
    }
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
    switch (b.action) {
      case "settings": return out(await saveSettings(b));
      case "vatPaid": return out(await saveVatPaid(b));
      case "delete": return out(await deleteExpense(b.id));
      default: return fail("action must be expense (multipart), settings, vatPaid or delete");
    }
  } catch (e) {
    return fail(`Couldn't do that: ${e instanceof Error ? e.message : "unknown error"}`, 500);
  }
}
