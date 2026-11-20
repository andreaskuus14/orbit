"use client";
import { useRef, useState } from "react";
import { downsample, encodeWav, ASR_RATE } from "@/lib/audio-pure";
import { DEST_IDS, destId, MAX_MEMO_SEC, MEMO_KINDS, type DestId, type Memo, type MemoItem, type MemoKind } from "@/lib/memos-pure";
import { useT } from "./i18n";

// Hold-to-record voice memo (phone remote and CORE on the PC). MediaRecorder → decoded here to 16 kHz mono WAV →
// /api/remote/memo, where local Whisper transcribes it and ORBIT files it. "Filed as…" card with change and undo. A brain dump (one memo,
// several things) comes back as a receipt: every item with its planet, change and undo.
const errorOf = async (r: Response) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`;

async function toWav(blob: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(downsample(buf.getChannelData(0), buf.sampleRate).slice(0, MAX_MEMO_SEC * ASR_RATE));
  } finally { void ctx.close().catch(() => {}); }
}

type Rec = { mr?: MediaRecorder; held: boolean; timer?: ReturnType<typeof setInterval> };
const PLANET = { gamedev: "creation", business: "business", life: "life", studio: "studio" } as const;

export function VoiceMemo({ compact = false }: { compact?: boolean }) {
  const { t, tn } = useT();
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [keep, setKeep] = useState(false);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [changing, setChanging] = useState<string | null>(null); // "" = the whole memo, else an item id
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
    catch { rec.current = null; return setErr(t("memo.mic")); }
    const chunks: Blob[] = [], mr = new MediaRecorder(stream), t0 = Date.now();
    r.mr = mr;
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(r.timer);
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      if (Date.now() - t0 < 700) { setState("idle"); return setErr(t("memo.tooShort")); }
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
    setState("busy"); setChanging(null);
    try {
      const wav = await toWav(blob);
      const r = await fetch(`/api/remote/memo?op=file${keep ? "&keep=1" : ""}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as Uint8Array<ArrayBuffer> });
      if (!r.ok) throw new Error(await errorOf(r));
      setMemo(((await r.json()) as { memo: Memo }).memo);
    } catch (e) { setErr(e instanceof Error ? e.message : t("memo.failed")); }
    setState("idle");
  }

  async function act(op: "refile" | "undo" | "start", kind?: MemoKind | DestId, item?: string) {
    if (!memo) return;
    setState("busy"); setErr("");
    try {
      const r = await fetch(`/api/remote/memo?op=${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: memo.id, kind, item }) });
      if (!r.ok) throw new Error(await errorOf(r));
      setMemo(((await r.json()) as { memo: Memo }).memo);
      setChanging(null);
    } catch (e) { setErr(e instanceof Error ? e.message : t("memo.failedShort")); }
    setState("idle");
  }

  const label = state === "rec" ? t("memo.rec", { n: secs }) : state === "busy" ? t("memo.busy") : compact ? t("memo.holdShort") : t("memo.hold");
  const busy = state === "busy";
  const kindLabel = (d: DestId) => t(`memo.dest.${d}`);
  const targetLabel = (i: MemoItem) => (i.target === "core" ? t("memo.target.core") : t(`planet.${PLANET[i.target]}`));
  const legacy = (m: Memo) => (
    <div className={compact ? "card space-y-2" : "space-y-2"} role="status">
      <div className="text-sm">{m.undone ? <>{t("memo.undone")}</> : <>{t("memo.filedAs", { kind: kindLabel(m.kind) })}{m.by === "model" ? ` ${t("memo.guess")}` : ""}{m.ref?.to === "task" && !m.started ? ` ${t("memo.notStarted")}` : ""}</>}</div>
      <p className="muted text-xs">“{m.text}”</p>
      {!m.undone && <div className="flex flex-wrap gap-2">
        <button type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => setChanging(changing === "" ? null : "")} aria-expanded={changing === ""}>{t("memo.change")}</button>
        {m.ref?.to === "task" && (m.started ? <span className="muted text-xs self-center">{t("memo.started")}</span>
          : <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("start")}>{t("memo.start")}</button>)}
        <button type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("undo")}>{t("memo.undo")}</button>
      </div>}
      {changing === "" && !m.undone && <div className="flex flex-wrap gap-2" role="group" aria-label={t("memo.fileAs")}>
        {MEMO_KINDS.filter((k) => k !== m.kind).map((k) => (
          <button key={k} type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("refile", k)}>{kindLabel(k)}</button>
        ))}
      </div>}
    </div>
  );
  const receipt = (m: Memo) => {
    const items = m.items ?? [], live = items.filter((i) => !i.undone).length;
    return (
      <div className={compact ? "card space-y-2" : "space-y-2"} role="status">
        <div className="flex items-center justify-between gap-2 text-sm">
          <b>{tn("memo.items", items.length)}</b>
          {live > 1 && <button type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("undo")}>{t("memo.undoAll")}</button>}
        </div>
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="space-y-1" style={{ opacity: i.undone ? 0.55 : 1 }}>
              <div className="text-sm"><span className="chip" style={{ pointerEvents: "none" }}>{targetLabel(i)}</span> <b>{kindLabel(destId(i))}</b>{i.game ? <span className="muted text-xs"> · {t("memo.inGame", { game: i.game })}</span> : null}
                {i.by === "model" ? <span className="muted text-xs"> {t("memo.guess")}</span> : null}{i.ref?.to === "task" && !i.started && !i.undone ? <span className="muted text-xs"> {t("memo.notStarted")}</span> : null}</div>
              <p className="muted text-xs">“{i.text}”</p>
              {i.by === "local" && <p className="muted text-xs">{t("memo.local")}</p>}
              {i.note && <p className="muted text-xs">{t(`memo.note.${i.note}`)}</p>}
              {i.undone ? <p className="muted text-xs">{t("memo.itemUndone")}</p> : <div className="flex flex-wrap gap-2">
                <button type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => setChanging(changing === i.id ? null : i.id)} aria-expanded={changing === i.id}>{t("memo.change")}</button>
                {i.ref?.to === "task" && (i.started ? <span className="muted text-xs self-center">{t("memo.started")}</span>
                  : <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("start", undefined, i.id)}>{t("memo.start")}</button>)}
                <button type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("undo", undefined, i.id)}>{t("memo.undo")}</button>
              </div>}
              {changing === i.id && !i.undone && <div className="flex flex-wrap gap-2" role="group" aria-label={t("memo.fileAs")}>
                {DEST_IDS.filter((d) => d !== destId(i)).map((d) => (
                  <button key={d} type="button" className="chip" style={{ minHeight: 40 }} disabled={busy} onClick={() => void act("refile", d, i.id)}>{kindLabel(d)}</button>
                ))}
              </div>}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <section className={compact ? "mt-2 space-y-2" : "rm-sec"} aria-labelledby={compact ? undefined : "r-memo"}>
      {!compact && <h2 id="r-memo" className="rm-label">{t("memo.title")}</h2>}
      <div className="flex items-center gap-3">
        <button type="button" className={state === "rec" ? "btn danger" : "btn"} disabled={state === "busy"} aria-pressed={state === "rec"}
          style={{ minHeight: compact ? undefined : 56, flex: compact ? undefined : 1, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none" }}
          onPointerDown={(e) => { e.preventDefault(); void start(); }} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); void start(); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stop(); }}>
          {label}
        </button>
        <label className="muted flex items-center gap-1 text-xs"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t("memo.keep")}</label>
      </div>
      {!compact && <p className="muted text-xs">{t("memo.help")}</p>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {memo && (memo.items ? receipt(memo) : legacy(memo))}
    </section>
  );
}
