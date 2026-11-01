import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { cloneVoice, cutOut, localHealth, makeModel, makeVoice } from "@/lib/local-ai";

// Local AI tools (tools/local-ai/server.py on this PC). Every action is the owner's own click; results are saved in VAULT only.
//   GET                                            → Health (local-ai-pure parseHealth)
//   POST multipart {action:"image3d"|"removebg", image, name}  → { saved }
//   POST multipart {action:"clone", sample, sampleText, text, consent:"own-voice", name} → { saved }
//   POST json {action:"tts", text, voice, name}    → { saved }
const MAX_BODY = 25 * 1024 * 1024;

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await localHealth());
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Files can be at most 25 MB" }, { status: 413 });
  try {
    let saved: string, what: string;
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const f = await req.formData();
      const action = f.get("action"), name = f.get("name") ?? undefined;
      if (action === "image3d" || action === "removebg") {
        const image = f.get("image");
        if (!(image instanceof Blob) || !image.size) return Response.json({ error: "Pick a picture first." }, { status: 400 });
        saved = await (action === "image3d" ? makeModel : cutOut)(image, name);
        what = action === "image3d" ? "3D model" : "cut-out";
      } else if (action === "clone") {
        const sample = f.get("sample");
        saved = await cloneVoice({ sample: sample instanceof Blob ? sample : new Blob([]), sampleText: String(f.get("sampleText") ?? ""), text: String(f.get("text") ?? ""), consent: f.get("consent") === "own-voice", name });
        what = "own-voice voiceover";
      } else return Response.json({ error: "Unknown action" }, { status: 400 });
    } else {
      const b = (await req.json().catch(() => ({}))) as { action?: string; text?: unknown; voice?: unknown; name?: unknown };
      if (b.action !== "tts") return Response.json({ error: "Unknown action" }, { status: 400 });
      saved = await makeVoice(b.text, b.voice, b.name);
      what = "voiceover";
    }
    logActivity({ area: "system", title: `Local AI made a ${what}: ${saved}`, detail: "Saved in VAULT on this PC" });
    return Response.json({ saved });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Local AI failed" }, { status: 502 });
  }
}
