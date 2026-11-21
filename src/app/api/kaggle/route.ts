import { requireUser } from "@/lib/supabase/server";
import { approvalGate } from "@/lib/approval-pure";
import { kaggleContent } from "@/lib/kaggle-pure";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// KAGGLE BURST (lib/kaggle.ts, docs/KAGGLE-BURST.md). Every upload is the owner's own click on one exact offer.
//   GET                                   → KaggleView {on, setup, quota, hoursLeft, job, offers}
//   POST {action:"approve", id, seen}     → starts the job: seen = contentHash(kaggleContent(offer)) of the script he read ("kaggle.upload")
//   POST {action:"decline", id}           → drops the offer (nothing was sent)
//   POST {action:"cancel"}                → stops the running Kaggle job (deletes ORBIT's private script there)
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await (await import("@/lib/kaggle")).kaggleView());
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; seen?: unknown } | null;
  const k = await import("@/lib/kaggle");
  const id = typeof b?.id === "string" ? b.id : "";
  try {
    if (b?.action === "approve") {
      const offer = (await k.kaggleView()).offers.find((o) => o.id === id);
      if (!offer) return Response.json({ error: "That Kaggle offer is gone or older than a day: ask again." }, { status: 404 });
      const why = await approvalGate("kaggle.upload", b.seen, kaggleContent(offer));
      if (why) return Response.json({ error: why }, { status: 409 });
      logActivity({ area: "system", title: `Approved a Kaggle upload: ${offer.title}`, detail: "One script, no files; private on his Kaggle account" });
      return Response.json({ job: await k.startOffer(id) });
    }
    if (b?.action === "decline") return Response.json({ ok: await k.declineOffer(id) });
    if (b?.action === "cancel") return Response.json({ ok: await k.cancelKaggle("Cancelled by you") });
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
