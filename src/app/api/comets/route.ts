import { requireUser } from "@/lib/supabase/server";
import { cometItems } from "@/lib/comet-pure";

export const dynamic = "force-dynamic";

/** Deadline comets for the galaxy: allowlisted commitments, sent invoices and decision revisits. Read-only; a failing source is left out. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const soft = <T,>(p: PromiseLike<T>, d: T) => Promise.resolve(p).catch(() => d);
  const [commitments, invoices, decisions] = await Promise.all([
    soft(import("@/lib/dayplan").then((m) => m.commitments()), []),
    soft(import("@/lib/invoices").then((m) => m.allInvoices()), []),
    soft(sb.from("memories").select("id,kind,title,tags,created_at").eq("user_id", user.id).eq("kind", "decision").limit(300)
      .then(async (r) => (await import("@/lib/memory-types-pure")).currentOnly(r.data ?? [], { now: Date.now() })), []),
  ]);
  return Response.json({ comets: cometItems({ commitments, invoices, decisions }, Date.now()) });
}
