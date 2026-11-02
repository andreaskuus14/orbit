import { requireUser } from "@/lib/supabase/server";
import { getLife } from "@/lib/life";
import { reflectJournal } from "@/lib/local-llm";

export const dynamic = "force-dynamic";

// LIFE → Journal "Reflect (on this PC)": POST → the local model's reflection on the last 7 days. Never Claude (local-llm.ts
// doesn't import claude.ts), only with ORBIT_LOCAL_PRIVATE=1, only on the owner's click. Nothing is saved or logged.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const r = await reflectJournal((await getLife()).journal, req.signal);
  return Response.json(r, { status: "error" in r ? 400 : 200 });
}
