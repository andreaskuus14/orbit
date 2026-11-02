"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import { CAPTION_LANGS, CATALOG, MAX_CLONE_CHARS, START_CMD, VOICES, cloneBlocked, encodeWav, isMediaName, spacesCsv, toolState, totalArea, type Health, type IfcSummary, type ToolId } from "@/lib/local-ai-pure";
import type { Autostart } from "@/lib/autostart-pure";
import type { LocalStatus } from "@/lib/local-model-pure";
import { useT } from "./i18n";
import RobloxBuild, { PINK } from "./RobloxBuild";

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
  const check = useCallback(() => { void fetch("/api/local-ai", { cache: "no-store" }).then((r) => r.json()).then(setH, () => setH(null)); }, []);
  useEffect(check, [check]);
  return [h, check] as const;
}

function State({ h, id, onCheck }: { h: Health | null; id: ToolId; onCheck: () => void }) {
  const s = toolState(h, id);
  return <p className="text-xs" style={{ color: s.ok ? "#4ade80" : "#fbbf24" }}>{s.text} <button className="chip ml-1" onClick={onCheck}>Check again</button></p>;
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
  const run = async (action: "image3d" | "removebg") => {
    if (!file) return;
    setBusy(action); setErr("");
    const f = new FormData(); f.append("action", action); f.append("image", file); f.append("name", name || file.name);
    try { const saved = await post(f); if (action === "image3d") setGlb(saved); else setPng(saved); }
    catch (e) { setErr(msg(e)); } finally { setBusy(""); check(); }
  };
  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Picture to 3D">
      <h3 className="brand text-sm" style={{ color: PINK }}>Picture to 3D (free, on your PC)</h3>
      <p className="muted text-xs">One clear picture of one object (a pet, a sword, a chest) on a plain background works best. Makes a .glb model in VAULT.</p>
      <State h={h} id="image3d" onCheck={check} />
      <input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs" aria-label="Picture" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input className="field text-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. golden-dragon-pet)" aria-label="Model name" />
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={!file || !!busy || !toolState(h, "image3d").ok} onClick={() => void run("image3d")}>{busy === "image3d" ? "Making the 3D model (1-3 min on GPU)…" : "🧊 Make 3D model"}</button>
        <button className="chip" disabled={!file || !!busy || !toolState(h, "removebg").ok} onClick={() => void run("removebg")}>{busy === "removebg" ? "Cutting out…" : "✂ Cut out background only"}</button>
      </div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {png && <p className="text-xs">Cut-out saved as <a className="underline" href={raw(png)} download>{png}</a> in VAULT.</p>}
      {glb && (
        <div className="grid gap-2">
          <div className="h-56 overflow-hidden rounded-lg bg-black/40">
            <Canvas camera={{ position: [0, 0.6, 2.2], fov: 45 }}>
              <ambientLight intensity={0.8} /><directionalLight position={[2, 3, 2]} intensity={1.2} />
              <Suspense fallback={null}><Bounds fit clip observe margin={1.2}><Model url={raw(glb)} /></Bounds></Suspense>
              <OrbitControls makeDefault />
            </Canvas>
          </div>
          <p className="text-xs">Saved as <a className="underline" href={raw(glb)} download>{glb}</a> in VAULT.</p>
          <details className="text-xs" open>
            <summary>Send to Roblox Studio</summary>
            {/* The Studio MCP bridge has no file-import tool (insert_asset needs a published asset id), so this step is his. */}
            <ol className="ml-4 list-decimal">
              <li>Download the .glb with the link above.</li>
              <li>In Roblox Studio: Home tab → Import 3D (or File → Import 3D) and pick the file.</li>
              <li>Check the scale in the preview, then Import. It lands in Workspace as a MeshPart you can resize.</li>
            </ol>
            <p className="muted">Colours come as vertex colours; if the model looks grey in Studio, paint it or give it a texture in Textures. Unreal: drag the .glb into the Content Browser.</p>
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
  return (
    <section className="grid gap-2 text-sm" aria-label="Text to 3D in Roblox">
      <div className="glass grid gap-2 rounded-xl p-3" style={{ borderColor: `${PINK}44` }}>
        <h3 className="brand text-sm" style={{ color: PINK }}>Text to 3D (Roblox Studio)</h3>
        <p className="muted text-xs">Describe one object. Roblox Studio makes a textured mesh in your open place with its own AI (Cube 3D). Free, runs on Roblox&apos;s servers.</p>
        <input className="field text-xs" maxLength={180} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Cute fluffy cat pet with big eyes" aria-label="Describe the object" />
        <button className="btn" disabled={prompt.trim().length < 3} onClick={() => setItem({ kind: "generate", prompt: prompt.trim() })}>Use this description</button>
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
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" aria-label="Voiceover">
      <h3 className="brand text-sm">🎙 Voiceover (free, on your PC)</h3>
      <div className="flex gap-2" role="group" aria-label="Voice">
        <button className="chip" aria-pressed={!own} onClick={() => setOwn(false)}>Preset voice</button>
        <button className="chip" aria-pressed={own} onClick={() => setOwn(true)}>My own voice</button>
      </div>
      <State h={h} id={id} onCheck={check} />
      <textarea className="field h-28 w-full text-xs" value={text} onChange={(e) => setText(e.target.value)} maxLength={own ? MAX_CLONE_CHARS : 5000}
        placeholder="Your script (English). Own-voice takes: up to 600 characters each." aria-label="Script" />
      {!own ? (
        <select className="field text-xs" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Preset voice">
          {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      ) : (
        <div className="grid gap-2 rounded-lg border border-white/10 p-2 text-xs">
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>This recording is <b>my own voice</b>. I only clone myself, never anyone else (no friends, streamers or celebrities).</span></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" onClick={() => void record()} disabled={!consent}>{rec ? "⏹ Stop recording" : "⏺ Record 10-20 s of me"}</button>
            <span className="muted">or a .wav of me:</span>
            <input type="file" accept=".wav,audio/wav" disabled={!consent} aria-label="Voice sample (WAV)" onChange={(e) => setSample(e.target.files?.[0] ?? null)} />
          </div>
          {sampleUrl && <audio controls src={sampleUrl} className="w-full" />}
          <input className="field text-xs" value={sampleText} onChange={(e) => setSampleText(e.target.value)} maxLength={500} placeholder="Exactly what you said in the sample" aria-label="What you said in the sample" />
          <p className="muted">Mark the video as using a synthetic voice where the platform asks (YouTube: altered or synthetic content).</p>
        </div>
      )}
      <input className="field text-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="File name (e.g. pet-sim-intro)" aria-label="File name" />
      <button className="btn" disabled={busy || !text.trim() || !!blocked || !toolState(h, id).ok} onClick={() => void make()}>{busy ? "Making the voiceover…" : "Make voiceover"}</button>
      {blocked && text.trim() && <p className="muted text-xs">{blocked}</p>}
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {saved && <><audio controls src={raw(saved)} className="w-full" /><p className="text-xs">Saved as <a className="underline" href={raw(saved)} download>{saved}</a> in VAULT.</p></>}
    </section>
  );
}

/** STUDIO → Produce → Captions: a VAULT clip (captions saved next to it) or an uploaded one → .srt, .vtt and a clean transcript. */
export function Captions() {
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
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" aria-label="Captions">
      <h3 className="brand text-sm">💬 Captions (free, on your PC)</h3>
      <p className="muted text-xs">Writes down what is said and saves subtitles (.srt for YouTube, .vtt) and a clean transcript in VAULT, next to the clip. English or Estonian.</p>
      <State h={h} id="captions" onCheck={check} />
      <select className="field text-xs" value={pick} onChange={(e) => { setPick(e.target.value); setUpload(null); }} aria-label="Video or audio in VAULT">
        <option value="">{files.length ? "Pick a video or audio file in VAULT…" : "No video or audio in VAULT yet"}</option>
        {files.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <label className="text-xs">or a file from this PC (up to 100 MB; only the captions are kept): <input type="file" accept="video/*,audio/*,.mkv,.m4a" className="text-xs"
        onChange={(e) => { setUpload(e.target.files?.[0] ?? null); setPick(""); }} /></label>
      <select className="field text-xs" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Spoken language">
        {CAPTION_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <button className="btn" disabled={busy || (!pick && !upload) || !toolState(h, "captions").ok} onClick={() => void make()}>{busy ? "Listening… (about a minute per 10 min of video on the GPU)" : "Make captions"}</button>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      {done && <p className="text-xs">Saved in VAULT{done.language ? ` (language: ${done.language}, ${done.device})` : ""}: {done.saved.map((n, i) => <span key={n}>{i ? ", " : ""}<a className="underline" href={raw(n)} download>{n}</a></span>)}.
        YouTube: Studio → Subtitles → Add → Upload file → the .srt. Check names and Estonian words before publishing.</p>}
    </section>
  );
}

/** VAULT file action: PDF/Word/PowerPoint/scan → Markdown saved beside it, so CORE can search and read it. */
export function ReadDocument({ name, onSaved }: { name: string; onSaved: (saved: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try { onSaved(await post({ action: "doc", file: name })); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return <>
    <button className="btn" disabled={busy} onClick={() => void run()} title="Docling on this PC (OPERATIONS → Local AI). The file never leaves the PC.">{busy ? "Reading the document…" : "Read document → Markdown"}</button>
    {err && <p className="error w-full text-xs" role="alert">{err}</p>}
  </>;
}

/** ARCH → Open IFC model: storeys, spaces with areas, element counts, materials, simple checks and a spaces CSV (IfcOpenShell on this PC). */
export function IfcOpen() {
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
    <div className="card space-y-1.5 text-xs" aria-label="Open IFC model">
      <div className="muted text-[10px] uppercase tracking-widest">Open IFC model</div>
      <State h={h} id="ifc" onCheck={check} />
      <input type="file" accept=".ifc" disabled={busy || !toolState(h, "ifc").ok} aria-label="IFC file" onChange={(e) => void open(e.target.files?.[0])} />
      {busy && <p className="muted">Reading the model…</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {m && <>
        <p><b>{m.project || s.name}</b> · {m.schema} · {m.storeys.length} storeys · {m.spaces.length} spaces, {totalArea(m)} m² · {Object.values(m.counts).reduce((a, b) => a + b, 0)} elements</p>
        {m.issues.length ? <ul className="pl-4">{m.issues.map((x) => <li key={x.kind} className="error">⚠ {x.text}: {x.count}{x.examples.length ? <span className="muted"> (e.g. {x.examples.slice(0, 3).join("; ")})</span> : null}</li>)}</ul>
          : <p style={{ color: "#4ade80" }}>✓ No issues found by the simple checks (names, space areas, duplicate GlobalIds).</p>}
        <details><summary className="cursor-pointer">Storeys</summary><ul className="muted pl-4">{m.storeys.map((x, i) => <li key={i}>{x.name || "(no name)"} · {x.elevation} m · {x.elements} elements</li>)}</ul></details>
        <details><summary className="cursor-pointer">Spaces</summary>
          <table className="w-full"><thead><tr className="muted"><th className="text-left">Storey</th><th className="text-left">Space</th><th className="text-right">m²</th></tr></thead>
            <tbody>{m.spaces.slice(0, 300).map((x) => <tr key={x.guid}><td>{x.storey}</td><td>{x.name}{x.longName ? ` · ${x.longName}` : ""}</td><td className="text-right">{x.area ?? "—"}</td></tr>)}</tbody></table>
          {m.spaces.length > 300 && <p className="muted">First 300 shown; the CSV has all {m.spaces.length}.</p>}</details>
        <details><summary className="cursor-pointer">Elements by type</summary><p className="muted">{Object.entries(m.counts).map(([k, v]) => `${k.replace(/^Ifc/, "")} ${v}`).join(" · ")}</p></details>
        <details><summary className="cursor-pointer">Materials</summary><p className="muted">{m.materials.map((x) => `${x.name} (${x.elements})`).join(" · ") || "none"}</p></details>
        <button className="chip" disabled={!m.spaces.length} onClick={csv}>⬇ Spaces and areas (CSV)</button>
      </>}
    </div>
  );
}

/** OPERATIONS → Local AI: what each tool does, whether it is installed, VRAM, license and the exact setup command. */
type Pc = { brain: LocalStatus & { private: boolean }; autostart: Autostart };

/** "This PC" rows above the tool list: the local brain (Ollama) and Starts with Windows. Data: /api/local-brain. */
function ThisPc() {
  const [pc, setPc] = useState<Pc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const check = useCallback(() => { void fetch("/api/local-brain", { cache: "no-store" }).then((r) => r.json()).then(setPc, () => setPc(null)); }, []);
  useEffect(check, [check]);
  const toggle = async (on: boolean) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/local-brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autostart: on }) });
      const j = (await r.json()) as { autostart?: Autostart & { log?: string }; error?: string };
      if (!r.ok || !j.autostart) throw new Error(j.error || `Request failed (${r.status})`);
      if (j.autostart.on !== on) setErr(j.autostart.log || "It didn't change. Run the command below in PowerShell in the ORBIT folder.");
      setPc((p) => (p ? { ...p, autostart: j.autostart! } : p));
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  if (!pc) return null;
  const a = pc.autostart, b = pc.brain;
  return (
    <div className="grid gap-2">
      <div className="glass grid gap-1 rounded-lg p-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>Local brain</b>
          <span style={{ color: b.state === "ok" ? "#4ade80" : b.state === "off" ? undefined : "#fbbf24" }} className={b.state === "off" ? "muted" : undefined}>{b.state === "ok" ? "Ready" : b.state === "off" ? "Off" : b.state === "missing" ? "Model not pulled" : "Not running"}</span></div>
        <p>{b.text}{b.state === "down" ? " ORBIT tried to start it (ollama serve); check again in a minute." : ""}</p>
        <p className="muted">A small model on this PC: answers chat and summaries when Claude is unreachable{b.private ? ", and reflects on your journal when you ask (LIFE → Journal), processed on this PC only" : ""}. Setup: <code className="select-all">powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1</code></p>
      </div>
      <div className="glass grid gap-1 rounded-lg p-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>Starts with Windows: {a.on === null ? "?" : a.on ? "on" : "off"}</b>
          {a.on !== null && <button className="chip" disabled={busy} onClick={() => void toggle(!a.on)}>{busy ? "Working…" : a.on ? "Turn off" : "Turn on"}</button>}</div>
        <p>{a.text}</p>
        <p className="muted">Or in PowerShell in the ORBIT folder: <code className="select-all">{a.command}</code></p>
        {err && <p style={{ color: "#fbbf24" }} className="whitespace-pre-wrap">{err}</p>}
      </div>
    </div>
  );
}

export function LocalAiTools() {
  const [h, check] = useHealth();
  const { lang } = useT();
  return (
    <section className="grid gap-3 text-sm" aria-label="Local AI tools">
      <ThisPc />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">{h?.running ? <>Service running{h.gpu ? ` on ${h.gpu.name} (${h.gpu.vramGb} GB)` : " on the CPU only (no GPU found)"}.</> : <>Service not running. Start it: <code>{START_CMD}</code></>}</p>
        <button className="chip" onClick={check}>Check again</button>
      </div>
      <p className="muted text-xs">Free models on this PC: nothing is uploaded and nothing costs credits. Results are saved in VAULT. One job runs at a time and each model leaves the GPU when done.</p>
      {CATALOG.map((c) => {
        const live = c.id === "text3d" || c.id === "motion" ? null : toolState(h, c.id);
        return (
          <div key={c.id} className="glass grid gap-1 rounded-lg p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{lang === "et" && c.et ? c.et.name : c.name}</b>
              <span style={{ color: live ? (live.ok ? "#4ade80" : "#fbbf24") : undefined }} className={live ? undefined : "muted"}>
                {live ? (live.ok ? "Ready" : h?.running ? "Not installed" : "Not running") : c.id === "text3d" ? "Uses Roblox Studio" : "Not available yet"}
              </span>
            </div>
            <p>{lang === "et" && c.et ? c.et.what : c.what}</p>
            <p className="muted">Model: {c.model} · VRAM: {c.vram}{h?.gpu && c.vramGb > h.gpu.vramGb ? " (more than your GPU has)" : ""} · License: {c.license} · Where: {c.where}</p>
            <p className="muted">Setup: <code className="select-all">{c.setup}</code></p>
          </div>
        );
      })}
    </section>
  );
}
