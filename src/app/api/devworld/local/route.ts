import { requireUser } from "@/lib/supabase/server";
import { LOCAL_MODEL } from "@/lib/claude";
import { OLLAMA_URL, localStatus } from "@/lib/local-model-pure";

// DEV world health line: is the offline brain (Ollama on this PC) reachable, and is ORBIT_LOCAL_MODEL pulled?
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const tags = LOCAL_MODEL ? await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null), () => null) : null;
  return Response.json(localStatus(LOCAL_MODEL, tags), { headers: { "Cache-Control": "no-store" } });
}
