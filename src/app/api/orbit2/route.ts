import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { missingSettings } from "@/lib/release-check-pure";
import { isLoopbackHost } from "@/lib/orbit2-local-pure";
import { ndjsonStream } from "@/lib/core-live-pure";
import { orbit2Info, runOrbit2 } from "@/lib/orbit2";
import { str } from "@/lib/pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorize(req: Request): Promise<Response | null> {
  const missing = missingSettings({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  // Local dev mode without Supabase configured: allow loopback requests only (never in cloud).
  if (missing.length > 0 && isLoopbackHost(req.headers.get("host"), process.env)) {
    return null;
  }
  const { res } = await requireUser();
  return res ?? null;
}

async function GET_(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  return Response.json(orbit2Info(), { headers: { "Cache-Control": "no-store" } });
}

async function POST_(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const message = str(body?.message ?? body?.prompt ?? "", 8000);
  if (!message) {
    return Response.json({ error: "Message is required (max 8000 chars)" }, { status: 400 });
  }

  const sessionId =
    typeof body?.sessionId === "string"
      ? body.sessionId
      : typeof body?.conversationId === "string"
        ? body.conversationId
        : null;
  const lang = body?.lang === "et" ? "et" : "en";
  const voice = body?.voice === true;
  const appendParts: string[] = [];
  if (lang === "et") appendParts.push("Answer in Estonian.");
  if (voice) appendParts.push("This was asked out loud: keep your reply brief and natural for speech.");
  const systemAppend = appendParts.length ? appendParts.join(" ") : undefined;

  const wantStream = new URL(req.url).searchParams.get("stream") !== "0";
  if (!wantStream) {
    try {
      const out = await runOrbit2({ prompt: message, sessionId, systemAppend, signal: req.signal });
      return Response.json({
        conversationId: out.sessionId,
        sessionId: out.sessionId,
        answer: out.text,
        model: out.model,
        engine: "orbit2",
        trace: out.trace,
      });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "ORBIT 2 failed" },
        { status: 502 },
      );
    }
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const stream = ndjsonStream(
    async (send) => {
      let sentTerminal = false;
      try {
        await runOrbit2({
          prompt: message,
          sessionId,
          systemAppend,
          signal: ac.signal,
          onEvent: (ev) => {
            if (ev.type === "done" || ev.type === "error") sentTerminal = true;
            send(ev as unknown as Record<string, unknown>);
          },
        });
      } catch (e) {
        if (!sentTerminal && !ac.signal.aborted) {
          send({ type: "error", error: e instanceof Error ? e.message : "ORBIT 2 failed" });
        }
      }
    },
    () => ac.abort(),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export const GET = guard("orbit2", GET_);
export const POST = guard("orbit2", POST_);
