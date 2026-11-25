import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { oauthEnv, readStored, wasExpired } from "@/lib/yt-oauth";
import { YT_UPLOAD_SCOPE, hasScopes } from "@/lib/yt-analytics-pure";

async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  const s = await readStored();
  return Response.json({ configured: !!oauthEnv(), connected: !!s, expired: wasExpired(), canUpload: hasScopes(s?.scope, [YT_UPLOAD_SCOPE]), ...(s && { channelTitle: s.channelTitle, connectedAt: s.connectedAt }) });
}
export const GET = guard("studio/oauth/status", GET_);
