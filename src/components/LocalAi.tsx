"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import { CAPTION_LANGS, CATALOG, MAX_CLONE_CHARS, START_CMD, VOICES, cloneBlocked, encodeWav, isMediaName, spacesCsv, toolState, totalArea, type Health, type IfcSummary, type ToolId } from "@/lib/local-ai-pure";
import { comfySetup, type ComfyHealth, type ComfyModel } from "@/lib/comfy-pure";
import { useT } from "./i18n";
import RobloxBuild, { PINK } from "./RobloxBuild";
import { KaggleBurst } from "./KaggleBurst";
import { ProgressCard } from "./ProgressCard";
import type { Progress } from "@/lib/progress-pure";
import { isComfyView, isHealthView, okJson } from "@/lib/json-guard-pure";

// Local AI tools (tools/local-ai on his PC): Picture to 3D and Text to 3D (GAME DEV → Assets), Voiceover (STUDIO → Produce),
// Captions (STUDIO → Produce), Read document (VAULT), Open IFC model (ARCH) and the tool list (OPERATIONS → Local AI). Every result is saved in VAULT; nothing is uploaded. Data: /api/local-ai.

const raw = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

async function postJson<T>(body: FormData | object): Promise<T> {
  const json = !(body instanceof FormData);
  const res = await fetch("/api/local-ai", { method: "POST", body: json ? JSON.stringify(body) : body, headers: json ? { "content-type": "application/json" } : undefined });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
async function post(body: FormData | object): Promise<string> {
  const { saved } = await postJson<{ saved?: string }>(body);
  if (!saved) throw new Error("Nothing was saved");
  return saved;
}

function useHealth() {
  const [h, setH] = useState<Health | null>(null);
  const check = useCallback(() => { void fetch("/api/local-ai", { cache: "no-store" }).then((r) => okJson<Health>(r, isHealthView)).then(setH, () => setH(null)); }, []);
  useEffect(check, [check]);
  return [h, check] as const;
}

function State({ h, id, onCheck }: { h: Health | null; id: ToolId; onCheck: () => void }) {
  const s = toolState(h, id);
  const { t } = useT();
  return <p className="text-xs" style={{ color: s.ok ? "#4ade80" : "#fbbf24" }}>{s.text} <button className="chip ml-1" onClick={onCheck}>{t("la.checkAgain")}</button></p>;
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

/** GAME DEV → Assets → Picture to 3D. */
export function PictureTo3D() {
  const [h, check] = useHealth();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"" | "image3d" | "removebg">("");
  const [err, setErr] = useState("");
  const [glb, setGlb] = useState("");
  const [png, setPng] = useState("");
  const { t } = useT();
  const run = async (action: "image3d" | "removebg") => {
    if (!file) return;
    setBusy(action); setErr("");
    const f = new FormData(); f.append("action", action); f.append("image", file); f.append("name", name || file.name);
    try { const saved = await post(f); if (action === "image3d") setGlb(saved); else setPng(saved); }
    catch (e) { setErr(msg(e)); } finally { setBusy(""); check(); }
  };
  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label={t("la.p3d")}>
      <h3 className="brand text-sm" style={{ color: PINK }}>{t("la.p3dTitle")}</h3>
      <p className="muted text-xs">{t("la.p3dHelp")}</p>
      <State h={h} id="image3d" onCheck={check} />
      {h?.running && !toolState(h, "image3d").ok && <p className="muted text-xs">{t("la.noTripo")}</p>}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs" aria-label={t("la.picture")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input className="field text-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("la.namePh")} aria-label={t("la.modelName")} />
      <div className="flex flex-wrap gap-2">
        {/* TripoSR off (its compiled package didn't build): the server uses the Pixal3D draft instead, so the button stays usable */}
        <button className="btn" disabled={!file || !!busy || !h?.running} onClick={() => void run("image3d")}>{busy === "image3d" ? t("la.making3d") : `🧊 ${t("la.make3d")}`}</button>
        <button className="chip" disabled={!file || !!busy || !toolState(h, "removebg").ok} onClick={() => void run("removebg")}>{busy === "removebg" ? t("la.cutting") : `✂ ${t("la.cutOnly")}`}</button>
      </div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {png && <p className="text-xs">{t("la.cutSaved")} <a className="underline" href={raw(png)} download>{png}</a> {t("la.inVault")}</p>}
      {glb && (
        <div className="grid gap-2">
          <div className="h-56 overflow-hidden rounded-lg bg-black/40">
            <Canvas camera={{ position: [0, 0.6, 2.2], fov: 45 }}>
              <ambientLight intensity={0.8} /><directionalLight position={[2, 3, 2]} intensity={1.2} />
              <Suspense fallback={null}><Bounds fit clip observe margin={1.2}><Model url={raw(glb)} /></Bounds></Suspense>
              <OrbitControls makeDefault />
            </Canvas>
          </div>
          <p className="text-xs">{t("la.savedAs")} <a className="underline" href={raw(glb)} download>{glb}</a> {t("la.inVault")}</p>
          <details className="text-xs" open>
            <summary>{t("la.toRoblox")}</summary>
            {/* The Studio MCP bridge has no file-import tool (insert_asset needs a published asset id), so this step is his. */}
            <ol className="ml-4 list-decimal">
              <li>{t("la.rb1")}</li>
              <li>{t("la.rb2")}</li>
              <li>{t("la.rb3")}</li>
            </ol>
            <p className="muted">{t("la.colours")}</p>
          </details>
        </div>
      )}
    </section>
  );
}

/** GAME DEV → Assets → Text to 3D: Roblox Studio's own generate_mesh (Cube 3D) through the existing plan → confirm → build flow. */
export function TextTo3D() {
  const [prompt, setPrompt] = useState("");
  const [item, setItem] = useState<{ kind: "generate"; prompt: string } | null>(null);
  const { t } = useT();
  return (
    <section className="grid gap-2 text-sm" aria-label={t("la.t3dAria")}>
      <div className="glass grid gap-2 rounded-xl p-3" style={{ borderColor: `${PINK}44` }}>
        <h3 className="brand text-sm" style={{ color: PINK }}>{t("la.t3dTitle")}</h3>
        <p className="muted text-xs">{t("la.t3dHelp")}</p>
        <input className="field text-xs" maxLength={180} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("la.t3dPh")} aria-label={t("la.describe")} />
        <button className="btn" disabled={prompt.trim().length < 3} onClick={() => setItem({ kind: "generate", prompt: prompt.trim() })}>{t("la.useDesc")}</button>
      </div>
      {item && <RobloxBuild item={item} />}
    </section>
  );
}

/** Browser recording (webm) → WAV, the format the cloning model reads. */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try { const b = await ctx.decodeAudioData(await blob.arrayBuffer()); return new Blob([encodeWav(b.getChannelData(0), b.sampleRate) as BlobPart], { type: "audio/wav" }); }
  finally { void ctx.close(); }
}

/** STUDIO → Produce → Voiceover: a preset voice, or his own cloned voice (his own recording + consent only). */
export function Voiceover() {
  const { t } = useT();
  const [h, check] = useHealth();
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<string>(VOICES[0].id);
  const [name, setName] = useState("");
  const [own, setOwn] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sample, setSample] = useState<Blob | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const chunks = useRef<Blob[]>([]);
  const sampleUrl = useMemo(() => (sample ? URL.createObjectURL(sample) : ""), [sample]);
  useEffect(() => () => { if (sampleUrl) URL.revokeObjectURL(sampleUrl); }, [sampleUrl]);

  const record = async () => {
    if (rec) { rec.stop(); return; }
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setRec(null); void toWav(new Blob(chunks.current)).then(setSample, (e) => setErr(msg(e))); };
      r.start(); setRec(r);
    } catch (e) { setErr(`Microphone: ${msg(e)}`); }
  };
  const blocked = own ? cloneBlocked({ consent, sampleBytes: sample?.size ?? 0, sampleText, text }) : "";
  const make = async () => {
    setBusy(true); setErr(""); setSaved("");
    try {
      if (!own) setSaved(await post({ action: "tts", text, voice, name: name || "voiceover" }));
      else {
        const f = new FormData();
        f.append("action", "clone"); f.append("sample", sample!, "sample.wav"); f.append("sampleText", sampleText); f.append("text", text);
        f.append("consent", consent ? "own-voice" : ""); f.append("name", name || "my-voice");
        setSaved(await post(f));
      }
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); check(); }
  };
  const id: ToolId = own ? "clone" : "tts";
  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" aria-label={t("la.vo")}>
      <h3 className="brand text-sm">🎙 {t("la.voTitle")}</h3>
      <div className="flex gap-2" role="group" aria-label={t("la.voice")}>
        <button className="chip" aria-pressed={!own} onClick={() => setOwn(false)}>{t("la.preset")}</button>
        <button className="chip" aria-pressed={own} onClick={() => setOwn(true)}>{t("la.own")}</button>
      </div>
      <State h={h} id={id} onCheck={check} />
      <textarea className="field h-28 w-full text-xs" value={text} onChange={(e) => setText(e.target.value)} maxLength={own ? MAX_CLONE_CHARS : 5000}
        placeholder={t("la.scriptPh")} aria-label={t("la.script")} />
      {!own ? (
        <select className="field text-xs" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={t("la.preset")}>
          {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      ) : (
        <div className="grid gap-2 rounded-lg border border-white/10 p-2 text-xs">
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("la.consentA")} <b>{t("la.consentB")}</b>{t("la.consentC")}</span></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" onClick={() => void record()} disabled={!consent}>{rec ? `⏹ ${t("la.stopRec")}` : `⏺ ${t("la.rec")}`}</button>
            <span className="muted">{t("la.orWav")}</span>
            <input type="file" accept=".wav,audio/wav" disabled={!consent} aria-label={t("la.sample")} onChange={(e) => setSample(e.target.files?.[0] ?? null)} />
          </div>
          {sampleUrl && <audio controls src={sampleUrl} className="w-full" />}
          <input className="field text-xs" value={sampleText} onChange={(e) => setSampleText(e.target.value)} maxLength={500} placeholder={t("la.saidPh")} aria-label={t("la.said")} />
          <p className="muted">{t("la.synthetic")}</p>
        </div>
      )}
      <input className="field text-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("la.filePh")} aria-label={t("la.file")} />
      <button className="btn" disabled={busy || !text.trim() || !!blocked || !toolState(h, id).ok} onClick={() => void make()}>{busy ? t("la.makingVo") : t("la.makeVo")}</button>
      {blocked && text.trim() && <p className="muted text-xs">{blocked}</p>}
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {saved && <><audio controls src={raw(saved)} className="w-full" /><p className="text-xs">{t("la.savedAs")} <a className="underline" href={raw(saved)} download>{saved}</a> {t("la.inVault")}</p></>}
    </section>
  );
}

/** STUDIO → Produce → Captions: a VAULT clip (captions saved next to it) or an uploaded one → .srt, .vtt and a clean transcript. */
export function Captions() {
  const { t } = useT();
  const [h, check] = useHealth();
  const [files, setFiles] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [lang, setLang] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ saved: string[]; language: string; device: string } | null>(null);
  useEffect(() => {
    void fetch("/api/vault", { cache: "no-store" }).then((r) => r.json()).then((j: { files?: { name: string; mtime: number }[] }) =>
      setFiles((j.files ?? []).filter((f) => isMediaName(f.name)).sort((a, b) => b.mtime - a.mtime).map((f) => f.name)), () => setFiles([]));
  }, [done]);
  const make = async () => {
    setBusy(true); setErr(""); setDone(null);
    try {
      if (upload) { const f = new FormData(); f.append("action", "captions"); f.append("media", upload); f.append("language", lang); setDone(await postJson(f)); }
      else setDone(await postJson({ action: "captions", file: pick, language: lang }));
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); check(); }
  };
  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" aria-label={t("la.cap")}>
      <h3 className="brand text-sm">💬 {t("la.capTitle")}</h3>
      <p className="muted text-xs">{t("la.capHelp")}</p>
      <State h={h} id="captions" onCheck={check} />
      <select className="field text-xs" value={pick} onChange={(e) => { setPick(e.target.value); setUpload(null); }} aria-label={t("la.media")}>
        <option value="">{files.length ? t("la.pickMedia") : t("la.noMedia")}</option>
        {files.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <label className="text-xs">{t("la.orFile")} <input type="file" accept="video/*,audio/*,.mkv,.m4a" className="text-xs"
        onChange={(e) => { setUpload(e.target.files?.[0] ?? null); setPick(""); }} /></label>
      <select className="field text-xs" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("la.spoken")}>
        {CAPTION_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <button className="btn" disabled={busy || (!pick && !upload) || !toolState(h, "captions").ok} onClick={() => void make()}>{busy ? t("la.listening") : t("la.makeCap")}</button>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {done && <p className="text-xs">{t("la.savedVault")}{done.language ? ` (${t("la.language", { l: done.language, d: done.device })})` : ""}: {done.saved.map((n, i) => <span key={n}>{i ? ", " : ""}<a className="underline" href={raw(n)} download>{n}</a></span>)}.
        {t("la.ytSubs")}</p>}
    </section>
  );
}

/** VAULT file action: PDF/Word/PowerPoint/scan → Markdown saved beside it, so CORE can search and read it. */
export function ReadDocument({ name, onSaved }: { name: string; onSaved: (saved: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try { onSaved(await post({ action: "doc", file: name })); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return <>
    <button className="btn" disabled={busy} onClick={() => void run()} title={t("la.doclingTitle")}>{busy ? t("la.readingDoc") : t("la.readDoc")}</button>
    {err && <p className="error w-full text-xs" role="alert">{err}</p>}
  </>;
}

/** ARCH → Open IFC model: storeys, spaces with areas, element counts, materials, simple checks and a spaces CSV (IfcOpenShell on this PC). */
export function IfcOpen() {
  const { t } = useT();
  const [h, check] = useHealth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [s, setS] = useState<{ name: string; summary: IfcSummary } | null>(null);
  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(""); setS(null);
    const f = new FormData(); f.append("action", "ifc"); f.append("file", file);
    try { setS({ name: file.name, summary: (await postJson<{ summary: IfcSummary }>(f)).summary }); } catch (e) { setErr(msg(e)); } finally { setBusy(false); check(); }
  };
  const csv = () => {
    if (!s) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + spacesCsv(s.summary)], { type: "text/csv" })); // BOM: Excel reads õ/ä/ü right
    a.download = `${s.name.replace(/\.ifc$/i, "")}-spaces.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const m = s?.summary;
  return (
    <div className="card space-y-1.5 text-xs" aria-label={t("la.ifc")}>
      <div className="muted text-[12px] font-medium">{t("la.ifc")}</div>
      <State h={h} id="ifc" onCheck={check} />
      <input type="file" accept=".ifc" disabled={busy || !toolState(h, "ifc").ok} aria-label={t("la.ifcFile")} onChange={(e) => void open(e.target.files?.[0])} />
      {busy && <p className="muted">{t("la.readingModel")}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {m && <>
        <p><b>{m.project || s.name}</b> · {m.schema} · {t("la.ifcSummary", { s: m.storeys.length, sp: m.spaces.length, a: totalArea(m), e: Object.values(m.counts).reduce((a, b) => a + b, 0) })}</p>
        {m.issues.length ? <ul className="pl-4">{m.issues.map((x) => <li key={x.kind} className="error">⚠ {x.text}: {x.count}{x.examples.length ? <span className="muted"> ({t("la.eg", { x: x.examples.slice(0, 3).join("; ") })})</span> : null}</li>)}</ul>
          : <p style={{ color: "#4ade80" }}>✓ {t("la.noIssues")}</p>}
        <details><summary className="cursor-pointer">{t("la.storeys")}</summary><ul className="muted pl-4">{m.storeys.map((x, i) => <li key={i}>{x.name || t("la.noName")} · {x.elevation} m · {t("la.elements", { n: x.elements })}</li>)}</ul></details>
        <details><summary className="cursor-pointer">{t("la.spaces")}</summary>
          <table className="w-full"><thead><tr className="muted"><th className="text-left">{t("la.storey")}</th><th className="text-left">{t("la.space")}</th><th className="text-right">m²</th></tr></thead>
            <tbody>{m.spaces.slice(0, 300).map((x) => <tr key={x.guid}><td>{x.storey}</td><td>{x.name}{x.longName ? ` · ${x.longName}` : ""}</td><td className="text-right">{x.area ?? "—"}</td></tr>)}</tbody></table>
          {m.spaces.length > 300 && <p className="muted">{t("la.first300", { n: m.spaces.length })}</p>}</details>
        <details><summary className="cursor-pointer">{t("la.byType")}</summary><p className="muted">{Object.entries(m.counts).map(([k, v]) => `${k.replace(/^Ifc/, "")} ${v}`).join(" · ")}</p></details>
        <details><summary className="cursor-pointer">{t("la.materials")}</summary><p className="muted">{m.materials.map((x) => `${x.name} (${x.elements})`).join(" · ") || t("la.none")}</p></details>
        <button className="chip" disabled={!m.spaces.length} onClick={csv}>⬇ {t("la.csv")}</button>
      </>}
    </div>
  );
}

export function LocalAiTools() {
  const [h, checkAi] = useHealth();
  const [comfy, setComfy] = useState<(ComfyHealth & { model: ComfyModel }) | null>(null); // ComfyUI is its own service (tools/comfyui)
  const check = useCallback(() => { checkAi(); void fetch("/api/local-ai?service=comfy", { cache: "no-store" }).then((r) => okJson<ComfyHealth & { model: ComfyModel }>(r, isComfyView)).then(setComfy, () => setComfy(null)); }, [checkAi]);
  useEffect(check, [check]);
  const { lang, t } = useT();
  return (
    <section className="grid gap-3 text-sm" aria-label={t("la.tools")}>
      <KaggleBurst />
      <GpuJobs />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">{h?.running ? <>{h.gpu ? t("la.svcGpu", { gpu: h.gpu.name, gb: h.gpu.vramGb }) : t("la.svcCpu")}</> : <>{t("la.svcDown")} <code>{START_CMD}</code></>}</p>
        <button className="chip" onClick={check}>{t("la.checkAgain")}</button>
      </div>
      <p className="muted text-xs">{t("la.freeHelp")}</p>
      {CATALOG.map((c) => {
        const nitro = c.id === "images" && comfy?.model === "nitrofusion2";
        const live = c.id === "images" ? (comfy?.running ? { ok: true } : null) : c.id === "text3d" || c.id === "motion" ? null : toolState(h, c.id);
        return (
          <div key={c.id} className="glass grid gap-1 rounded-lg p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{lang === "et" && c.et ? c.et.name : c.name}</b>
              <span style={{ color: live ? (live.ok ? "#4ade80" : "#fbbf24") : undefined }} className={live ? undefined : "muted"}>
                {t(live ? (live.ok ? (nitro ? "la.comfy" : "la.ready") : h?.running ? "la.notInstalled" : "la.notRunning") : c.id === "text3d" ? "la.usesRoblox" : c.id === "images" ? (comfy?.installed ? "la.starting" : "la.notInstalled") : "la.notYet")}
              </span>
            </div>
            <p>{lang === "et" && c.et ? c.et.what : c.what}</p>
            <p className="muted">{nitro ? t("la.nitro") : <>{t("la.model")}: {c.model} · VRAM: {c.vram}{h?.gpu && c.vramGb > h.gpu.vramGb ? ` ${t("la.moreVram")}` : ""} · {t("la.license")}: {c.license}</>} · {t("la.where")}: {c.where}</p>
            <p className="muted">{t("la.setup")}: <code className="select-all">{nitro ? comfySetup("nitrofusion2") : c.setup}</code></p>
          </div>
        );
      })}
    </section>
  );
}

/** Queued GPU jobs (only with ORBIT_GPU_QUEUE=1): the shared progress card per job, with Cancel while it isn't finished. */
function GpuJobs() {
  const { lang } = useT();
  const [jobs, setJobs] = useState<Progress[]>([]);
  const load = useCallback(() => { void fetch(`/api/gpu-jobs?lang=${lang}`, { cache: "no-store" }).then((r) => r.json()).then((j: { jobs?: Progress[] }) => setJobs(j.jobs ?? []), () => {}); }, [lang]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  if (!jobs.length) return null;
  const cancel = (id: string) => void fetch("/api/gpu-jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: id.replace(/^gpu:/, ""), action: "cancel" }) }).then(load);
  return (
    <div className="grid gap-2" aria-label={lang === "et" ? "GPU tööd" : "GPU jobs"}>
      <b className="text-xs">{lang === "et" ? "GPU järjekord" : "GPU queue"}</b>
      {jobs.slice(0, 6).map((p) => (
        <ProgressCard key={p.id} p={p} compact>
          {p.phase === "working" || p.phase === "waiting" ? <button className="chip" onClick={() => cancel(p.id)}>{lang === "et" ? "Tühista" : "Cancel"}</button> : null}
        </ProgressCard>
      ))}
    </div>
  );
}
