import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { coreTurn } from "@/lib/core-turn";

export const maxDuration = 300;

async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  return coreTurn(req, sb, user.id, body && typeof body === "object" ? body : {});
}

/** The effective CORE setup (models, limits, session mode) for the DEV world readout. */
async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json((await import("@/lib/core-config")).coreConfig());
}
export const POST = guard("core", POST_);
export const GET = guard("core", GET_);
