import { requireUser } from "@/lib/supabase/server";
import { topicFeedUrl, WORLD_PACK } from "@/lib/pulse";
import { str } from "@/lib/pure";

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("feeds").select("id, url, title, topic, enabled, last_fetched_at, last_error").order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ feeds: data });
}

/** Add a news topic (becomes a Google News search feed) or any RSS/Atom URL. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (body.pack === "world") {
    const { data, error } = await sb.from("feeds")
      .upsert(WORLD_PACK.map((f) => ({ ...f, user_id: user.id })), { onConflict: "user_id,url", ignoreDuplicates: true }).select("id");
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ added: data?.length ?? 0 }, { status: 201 });
  }
  const topic = str(body.topic, 100);
  const url = str(body.url, 2000);
  if (topic === null || url === null || (!topic && !url)) return Response.json({ error: "Give a topic or a feed URL" }, { status: 400 });
  let row;
  if (url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      row = { user_id: user.id, url: u.toString(), title: str(body.title, 200) || u.hostname, topic: null };
    } catch {
      return Response.json({ error: "That isn't a valid http(s) URL" }, { status: 400 });
    }
  } else {
    row = { user_id: user.id, url: topicFeedUrl(topic!), title: `News: ${topic}`, topic };
  }
  const { data, error } = await sb.from("feeds").insert(row).select("id, url, title, topic, enabled, last_fetched_at, last_error").single();
  if (error) return Response.json({ error: error.code === "23505" ? "You already follow that" : error.message }, { status: 400 });
  return Response.json({ feed: data }, { status: 201 });
}

export async function PATCH(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id, enabled } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof enabled !== "boolean") return Response.json({ error: "Bad request" }, { status: 400 });
  const { data, error } = await sb.from("feeds").update({ enabled }).eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const { data, error } = await sb.from("feeds").delete().eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
