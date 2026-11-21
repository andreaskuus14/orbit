"use client";
// Settings → More → Your voice for dubbing: his own 10-60 s sample + his consent, for the STUDIO bilingual dub (lib/clips/dub-pure.ts).
// Stored on this PC only (<studio>/dub); API: /api/studio/dub. The consent sent is the server's exact statement (CONSENT_TEXT).
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeWav } from "@/lib/local-ai-pure";
import { useT } from "./i18n";

type State = { voice: { consent: boolean; sample: boolean; consentAt?: string; seconds?: number }; consentText: string; tool: { running: boolean; installed: boolean } };
const API = "/api/studio/dub";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try { const b = await ctx.decodeAudioData(await blob.arrayBuffer()); return new Blob([encodeWav(b.getChannelData(0), b.sampleRate) as BlobPart], { type: "audio/wav" }); }
  finally { void ctx.close(); }
}

export function DubVoiceSection() {
  const { t } = useT();
  const [s, setS] = useState<State | null>(null);
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState<Blob | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const chunks = useRef<Blob[]>([]);
  const url = useMemo(() => (sample ? URL.createObjectURL(sample) : ""), [sample]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const load = () => fetch(API).then(async (r) => { // an error reply ({ error }) is not a state: rendering it crashed all of Profile
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.voice || !j?.tool) throw new Error(j?.error || `Failed (${r.status})`);
    setS(j as State);
  }).catch((e) => setNote(msg(e)));
  useEffect(() => { void load(); }, []);

  const record = async () => {
    if (rec) { rec.stop(); return; }
    setNote("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setRec(null); void toWav(new Blob(chunks.current)).then(setSample, (e) => setNote(msg(e))); };
      r.start(); setRec(r);
    } catch (e) { setNote(msg(e)); }
  };
  const save = async () => {
    if (!s || !sample) return;
    setBusy(true); setNote("");
    try {
      const f = new FormData(); f.append("sample", sample, "my-voice.wav"); f.append("consent", s.consentText);
      const r = await fetch(API, { method: "POST", body: f }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setNote(t("dub.saved")); setSample(null); setConsent(false); await load();
    } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { // "removed" only when the server says so: a failed delete must not tell him his voice sample is gone
      const r = await fetch(API, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Failed (${r.status})`); }
      setNote(t("dub.removed")); await load();
    } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-2" aria-labelledby="dubvoice-h">
      <h3 id="dubvoice-h" className="h3">{t("dub.title")}</h3>
      <p className="muted text-xs">{t("dub.intro")} {t("dub.local")}</p>
      {s && !s.tool.installed && <p className="text-xs">{t("dub.tool")} <code>powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1 -Dub</code></p>}
      {s?.voice.consent ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>✓ {t("dub.set", { sec: String(s.voice.seconds ?? "?"), at: s.voice.consentAt ? new Date(s.voice.consentAt).toLocaleDateString() : "?" })}</span>
          <button className="chip" disabled={busy} onClick={() => void remove()}>{t("dub.remove")}</button>
        </div>
      ) : (
        <div className="grid gap-2 text-xs">
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{t("dub.consent")}</span></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" onClick={() => void record()} disabled={!consent}>{rec ? t("dub.stop") : t("dub.record")}</button>
            <span className="muted">{t("dub.or")}</span>
            <input type="file" accept=".wav,audio/wav" disabled={!consent} aria-label={t("dub.or")} onChange={(e) => setSample(e.target.files?.[0] ?? null)} />
          </div>
          {url && <audio controls src={url} className="w-full" />}
          <button className="btn" disabled={busy || !consent || !sample || !s} onClick={() => void save()}>{t("dub.save")}</button>
        </div>
      )}
      {note && <p className="muted text-xs" role="status">{note}</p>}
    </section>
  );
}
