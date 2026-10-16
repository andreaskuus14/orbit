import { requireUser } from "@/lib/supabase/server";
import { scoutFail as fail } from "@/lib/clips/scout";
import { theater } from "@/lib/watch";
import { isPageToken, regionCode } from "@/lib/watch-pure";

export const dynamic = "force-dynamic";

// THEATER: GET ?creator=jynxzi | ?topic=cs2 | ?trending=1, plus [&sort=viral|new][&shorts=1][&page=<nextPageToken>][&region=US][&fallback=1]
// → { videos, next?, channel?, topic?, note?, unitsLeft? }. Costs: creator 2-3 units a page, topic 101, trending 1 (see lib/watch.ts).
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  const page = q.get("page");
  if (page != null && !isPageToken(page)) return Response.json({ error: "Bad page token" }, { status: 400 });
  try {
    return Response.json(await theater({ creator: q.get("creator"), topic: q.get("topic"), trending: q.get("trending") === "1", shorts: q.get("shorts") === "1",
      sort: q.get("sort") === "new" ? "new" : "viral", page: page ?? undefined, region: regionCode(q.get("region")), fallback: q.get("fallback") === "1" }));
  } catch (e) { return fail(e); }
}
