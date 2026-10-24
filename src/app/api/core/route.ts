import { requireUser } from "@/lib/supabase/server";
import { coreTurn } from "@/lib/core-turn";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  return coreTurn(req, sb, user.id, body && typeof body === "object" ? body : {});
}
