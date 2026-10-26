"use client";
import { useRef, useState } from "react";
import { downsample, encodeWav, ASR_RATE } from "@/lib/audio-pure";
import { MAX_MEMO_SEC, MEMO_KINDS, MEMO_LABEL, type Memo, type MemoKind } from "@/lib/memos-pure";

// Hold-to-record voice memo (phone remote and CORE on the PC). MediaRecorder → decoded here to 16 kHz mono WAV →
// /api/remote/memo, where local Whisper transcribes it and ORBIT files it. "Filed as…" card with change and undo.
const errorOf = async (r: Response) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`;

async function toWav(blob: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(downsample(buf.getChannelData(0), buf.sampleRate).slice(0, MAX_MEMO_SEC * ASR_RATE));
  } finally { void ctx.close().catch(() => {}); }
}

type Rec = { mr?: MediaRecorder; held: boolean; timer?: ReturnType<typeof setInterval> };

export function VoiceMemo({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [keep, setKeep] = useState(false);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [changing, setChanging] = useState(false);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const rec = useRef<Rec | null>(null);

  async function start() {
    if (rec.current || state === "busy") return;
    const r: Rec = { held: true };
    rec.current = r;
    setErr(""); setSecs(0);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { rec.current = null; return setErr("Microphone blocked: allow it for this page in Settings."); }
    const chunks: Blob[] = [], mr = new MediaRecorder(stream), t0 = Date.now();
    r.mr = mr;
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(r.timer);
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      if (Date.now() - t0 < 700) { setState("idle"); return setErr("Hold the button while you talk."); }
      void upload(new Blob(chunks, { type: mr.mimeType }));
    };
    mr.start();
    setState("rec");
    r.timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setSecs(s); if (s >= MAX_MEMO_SEC) stop(); }, 250);
    if (!r.held) stop(); // released before the mic was ready
  }
  function stop() {
    const r = rec.current;
    if (!r) return;
    r.held = false;
    if (r.mr?.state === "recording") r.mr.stop();
  }

  async function upload(blob: Blob) {
    setState("busy"); setChanging(false);
    try {
      const wav = await toWav(blob);
      const r = await fetch(`/api/remote/memo?op=file${keep ? "&keep=1" : ""}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as Uint8Array<ArrayBuffer> });
      if (!r.ok) throw new Error(await errorOf(r));
      setMemo(((await r.json()) as { memo: Memo }).memo);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't file the memo"); }
    setState("idle");
  }

  async function act(op: "refile" | "undo", kind?: MemoKind) {
    if (!memo) return;
    setState("busy"); setErr("");
    try {
      const r = await fetch(`/api/remote/memo?op=${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: memo.id, kind }) });
      if (!r.ok) throw new Error(await errorOf(r));
      setMemo(((await r.json()) as { memo: Memo }).memo);
      setChanging(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setState("idle");
  }

  const label = state === "rec" ? `Recording… ${secs}s (release to file)` : state === "busy" ? "Filing…" : compact ? "🎙 Hold for memo" : "Hold to record a memo";
  return (
    <section className={compact ? "mt-2 space-y-2" : "card space-y-2"} aria-labelledby={compact ? undefined : "r-memo"}>
      {!compact && <h2 id="r-memo" className="text-sm font-semibold">Voice memo</h2>}
      <div className="flex items-center gap-3">
        <button type="button" className={state === "rec" ? "btn danger" : "btn"} disabled={state === "busy"} aria-pressed={state === "rec"}
          style={{ minHeight: compact ? undefined : 56, flex: compact ? undefined : 1, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none" }}
          onPointerDown={(e) => { e.preventDefault(); void start(); }} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); void start(); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stop(); }}>
          {label}
        </button>
        <label className="muted flex items-center gap-1 text-xs"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep audio</label>
      </div>
      {!compact && <p className="muted text-xs">Up to 2 minutes. Transcribed on the PC; the audio is deleted afterwards unless you keep it.</p>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {memo && (
        <div className={compact ? "card space-y-2" : "space-y-2"} role="status">
          <div className="text-sm">{memo.undone ? <>Undone: <b>not filed</b></> : <>Filed as <b>{MEMO_LABEL[memo.kind]}</b>{memo.by === "model" ? " (AI guess)" : ""}</>}</div>
          <p className="muted text-xs">“{memo.text}”</p>
          {!memo.undone && <div className="flex flex-wrap gap-2">
            <button type="button" className="chip" style={{ minHeight: 40 }} disabled={state === "busy"} onClick={() => setChanging((v) => !v)} aria-expanded={changing}>Change</button>
            <button type="button" className="chip" style={{ minHeight: 40 }} disabled={state === "busy"} onClick={() => void act("undo")}>Undo</button>
          </div>}
          {changing && !memo.undone && <div className="flex flex-wrap gap-2" aria-label="File as">
            {MEMO_KINDS.filter((k) => k !== memo.kind).map((k) => (
              <button key={k} type="button" className="chip" style={{ minHeight: 40 }} disabled={state === "busy"} onClick={() => void act("refile", k)}>{MEMO_LABEL[k]}</button>
            ))}
          </div>}
        </div>
      )}
    </section>
  );
}
