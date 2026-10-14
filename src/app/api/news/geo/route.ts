import { requireUser } from "@/lib/supabase/server";
import { hotspots } from "@/lib/geo";

// News hotspots for the INTELLIGENCE globe: the user's recent articles grouped by the country they're about.
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const hours = Math.min(24 * 14, Math.max(6, Number(new URL(req.url).searchParams.get("hours")) || 72));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await sb.from("articles").select("title, url, source, summary, published_at")
    .gte("fetched_at", since).order("fetched_at", { ascending: false }).limit(800);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const { hotspots: hs, untagged } = hotspots(data ?? []);
  return Response.json({ hours, total: data?.length ?? 0, untagged, hotspots: hs });
}
