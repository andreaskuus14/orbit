import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { getStudio } from "@/lib/youtube";

// STUDIO world: the owner's YouTube channel and latest videos. ?refresh=1 bypasses the cache (rate-limited).
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  try {
    const data = await getStudio(new URL(req.url).searchParams.get("refresh") === "1");
    return Response.json(data.configured ? data : { ...data, setup: { env: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL"] } });
  } catch (e) {
    return Response.json({ error: safeMessage(e, "Couldn't load the channel") }, { status: 502 });
  }
}
