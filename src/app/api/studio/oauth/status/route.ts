import { requireUser } from "@/lib/supabase/server";
import { oauthEnv, readStored } from "@/lib/yt-oauth";

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const s = await readStored();
  return Response.json({ configured: !!oauthEnv(), connected: !!s, ...(s && { channelTitle: s.channelTitle, connectedAt: s.connectedAt }) });
}
