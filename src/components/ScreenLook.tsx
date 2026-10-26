"use client";
import { useEffect, useRef, useState } from "react";
import { fitSize, lookPrompt, SCREEN_NAME, type Preset } from "@/lib/screen-look-pure";

// "Look at my screen" (roadmap D3): only on his click, Ctrl+Shift+L, or a spoken/typed ask he confirms with a click.
// One frame, then the capture stream is stopped. The JPEG lives in memory for this one CORE turn; "Save" downloads it, nothing else keeps it.

/** He picks a window/screen in the browser's own dialog; we grab one frame, stop every track, and downsize. */
async function captureOnce(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "exclude" } as DisplayMediaStreamOptions);
  try {
    const v = document.createElement("video");
    v.muted = true; v.srcObject = stream;
    await v.play();
    await new Promise((ok) => requestAnimationFrame(ok)); // first decoded frame
    const { width, height } = fitSize(v.videoWidth, v.videoHeight);
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    c.getContext("2d")!.drawImage(v, 0, 0, width, height);
    v.srcObject = null;
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    if (!blob) throw new Error("Couldn't read that window");
    return new File([blob], SCREEN_NAME, { type: "image/jpeg" });
  } finally { stream.getTracks().forEach((t) => t.stop()); }
}

export type LookAsk = { question: string; preset: Preset };

/** The 👁 strip above CORE's composer: buttons, hotkey, the "ORBIT is looking" indicator and the one-shot Save link. */
export function ScreenLook({ busy, input, ask, onAsk, run }: {
  busy: boolean; input: string; ask: LookAsk | null; onAsk: (a: LookAsk | null) => void;
  run: (file: File, text: string, preset: Preset) => Promise<void>;
}) {
  const [state, setState] = useState<"" | "picking" | "looking">("");
  const [err, setErr] = useState("");
  const [shot, setShot] = useState(""); // object URL of the last frame, for Save; revoked on the next look / dismiss / unmount
  const shotRef = useRef("");
  const keep = (url: string) => { if (shotRef.current) URL.revokeObjectURL(shotRef.current); shotRef.current = url; setShot(url); };
  useEffect(() => () => { if (shotRef.current) URL.revokeObjectURL(shotRef.current); }, []);

  const look = async (question: string, preset: Preset) => {
    if (busy || state) return;
    setErr(""); onAsk(null); setState("picking");
    try {
      const file = await captureOnce();
      keep(URL.createObjectURL(file));
      setState("looking");
      await run(file, lookPrompt(question, preset), preset);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setErr(name === "NotAllowedError" || name === "AbortError" ? "Cancelled: nothing was captured." : e instanceof Error ? e.message : "Screen capture failed");
    } finally { setState(""); }
  };
  const latest = useRef(look); latest.current = look;
  const text = useRef(input); text.current = input;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); void latest.current(text.current, "general"); }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, []);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      {state
        ? <span className="chip" role="status" aria-live="assertive" style={{ borderColor: "#f59e0b", color: "#f59e0b" }}>
            👁 {state === "picking" ? "Pick the window ORBIT should look at…" : "ORBIT is looking at your screenshot…"}</span>
        : <>
            <button type="button" className="chip" disabled={busy} onClick={() => void look(input, "general")} title="Show ORBIT one screenshot of a window you pick (Ctrl+Shift+L). Uses what you typed as the question.">👁 Look at my screen</button>
            <button type="button" className="chip" disabled={busy} onClick={() => void look(input, "roblox")} title="Screenshot Roblox Studio: ORBIT reads the errors and links a docs-checked fix">🧩 Roblox error</button>
          </>}
      {ask && !state && (
        <span className="chip inline-flex items-center gap-1.5" role="status">
          <button type="button" className="underline" onClick={() => void look(ask.question, ask.preset)}>👁 Choose the window to show ORBIT</button>
          <button type="button" aria-label="Cancel screen look" onClick={() => onAsk(null)}>✕</button>
        </span>
      )}
      {shot && !state && (
        <span className="chip inline-flex items-center gap-1.5">
          <img src={shot} alt="Last screenshot shown to ORBIT" className="h-6 w-10 rounded object-cover" />
          <a href={shot} download={`orbit-screen-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.jpg`} className="underline" title="Not kept anywhere unless you save it">💾 Save</a>
          <button type="button" aria-label="Forget this screenshot" onClick={() => keep("")}>✕</button>
        </span>
      )}
      {err && <span className="text-red-400" role="alert">{err}</span>}
    </div>
  );
}
