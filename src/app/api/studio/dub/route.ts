import { requireUser } from "@/lib/supabase/server";
import { deleteVoice, saveVoice, voiceState } from "@/lib/clips/dub";
import { localHealth } from "@/lib/local-ai";
import { CONSENT_TEXT } from "@/lib/clips/dub-pure";

// His voice for the bilingual dub: GET = is it set (and is the local dub tool installed), POST multipart {sample: WAV, consent: CONSENT_TEXT},
// DELETE = remove the sample and the consent. The sample stays on this PC (<studio>/dub) and is only sent to the local AI service.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const [voice, h] = await Promise.all([voiceState(), localHealth().catch(() => null)]);
  return Response.json({ voice, consentText: CONSENT_TEXT, tool: { running: !!h?.running, installed: !!h?.tools.dub } });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const f = await req.formData().catch(() => null);
  const sample = f?.get("sample");
  if (!(sample instanceof Blob) || sample.size > 20 * 1024 * 1024) return Response.json({ error: "Send a WAV sample (at most 20 MB)" }, { status: 400 });
  const no = await saveVoice(new Uint8Array(await sample.arrayBuffer()), f?.get("consent"));
  if (no) return Response.json({ error: no }, { status: 400 });
  return Response.json({ voice: await voiceState() });
}

export async function DELETE() {
  const { res } = await requireUser();
  if (res) return res;
  await deleteVoice();
  return Response.json({ voice: await voiceState() });
}
