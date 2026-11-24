import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { follow, followedNews, unfollow } from "@/lib/follows";

// INTELLIGENCE topic watch. GET: followed topics with their latest headlines (?visit=1 marks this as a visit,
// for "new since last visit"). POST {topic}: follow. DELETE ?topic=: unfollow.

async function GET_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await followedNews(new URL(req.url).searchParams.get("visit") === "1"));
}

async function POST_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const r = await follow(body?.topic);
  return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r);
}

async function DELETE_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const topic = new URL(req.url).searchParams.get("topic")?.slice(0, 80);
  if (!topic) return Response.json({ error: "Missing topic" }, { status: 400 });
  return Response.json({ removed: await unfollow(topic) });
}
export const GET = guard("news/follows", GET_);
export const POST = guard("news/follows", POST_);
export const DELETE = guard("news/follows", DELETE_);
