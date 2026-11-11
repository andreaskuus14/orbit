import { requireUser } from "@/lib/supabase/server";
import { briefingAudio } from "@/lib/briefing-audio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A briefing as a two-voice audio show (WAV), made once with the local Kokoro voices and then served from disk. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad briefing id" }, { status: 400 });
  const { data, error } = await sb.from("briefings").select("id, title, content, created_at").eq("user_id", user.id).eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Briefing not found" }, { status: 404 });
  try {
    const wav = await briefingAudio(data);
    return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    return Response.json({ error: `Couldn't make the audio: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
}
