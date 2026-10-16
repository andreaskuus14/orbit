import { requireUser } from "@/lib/supabase/server";
import { follow, followedNews, unfollow } from "@/lib/follows";

// INTELLIGENCE topic watch. GET: followed topics with their latest headlines (?visit=1 marks this as a visit,
// for "new since last visit"). POST {topic}: follow. DELETE ?topic=: unfollow.

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await followedNews(new URL(req.url).searchParams.get("visit") === "1"));
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const r = await follow(body?.topic);
  return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r);
}

export async function DELETE(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const topic = new URL(req.url).searchParams.get("topic")?.slice(0, 80);
  if (!topic) return Response.json({ error: "Missing topic" }, { status: 400 });
  return Response.json({ removed: await unfollow(topic) });
}
