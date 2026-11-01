"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import { CATALOG, MAX_CLONE_CHARS, START_CMD, VOICES, cloneBlocked, encodeWav, toolState, type Health, type ToolId } from "@/lib/local-ai-pure";
import RobloxBuild, { PINK } from "./RobloxBuild";

// Local AI tools (tools/local-ai on his PC): Picture to 3D and Text to 3D (GAME DEV → Assets), Voiceover (STUDIO → Produce),
// and the tool list (OPERATIONS → Local AI). Every result is saved in VAULT; nothing is uploaded. Data: /api/local-ai.

const raw = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

async function post(body: FormData | object): Promise<string> {
  const json = !(body instanceof FormData);
  const res = await fetch("/api/local-ai", { method: "POST", body: json ? JSON.stringify(body) : body, headers: json ? { "content-type": "application/json" } : undefined });
  const j = (await res.json().catch(() => ({}))) as { saved?: string; error?: string };
  if (!res.ok || !j.saved) throw new Error(j.error || `Request failed (${res.status})`);
  return j.saved;
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

/** OPERATIONS → Local AI: what each tool does, whether it is installed, VRAM, license and the exact setup command. */
export function LocalAiTools() {
  const [h, check] = useHealth();
  return (
    <section className="grid gap-3 text-sm" aria-label="Local AI tools">
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
              <b>{c.name}</b>
              <span style={{ color: live ? (live.ok ? "#4ade80" : "#fbbf24") : undefined }} className={live ? undefined : "muted"}>
                {live ? (live.ok ? "Ready" : h?.running ? "Not installed" : "Not running") : c.id === "text3d" ? "Uses Roblox Studio" : "Not available yet"}
              </span>
            </div>
            <p>{c.what}</p>
            <p className="muted">Model: {c.model} · VRAM: {c.vram}{h?.gpu && c.vramGb > h.gpu.vramGb ? " (more than your GPU has)" : ""} · License: {c.license} · Where: {c.where}</p>
            <p className="muted">Setup: <code className="select-all">{c.setup}</code></p>
          </div>
        );
      })}
    </section>
  );
}
