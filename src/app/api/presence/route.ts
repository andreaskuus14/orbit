import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { notePresence } from "@/lib/presence";

export const dynamic = "force-dynamic";

// Owner heartbeat (PresenceBeat.tsx, at most once a minute while he is using the visible app). Stamps only the time: background
// Claude work then keeps headroom for him (usage-pace-pure.ts). 401 without a session; no body.
async function POST_() {
  const { res } = await requireUser();
  if (res) return res;
  notePresence("ui");
  return Response.json({ ok: true });
}
export const POST = guard("presence", POST_);
