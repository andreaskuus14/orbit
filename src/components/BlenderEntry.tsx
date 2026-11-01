"use client";
import { useEffect, useState } from "react";
import { VOICE_ASK } from "./voice/bus";
import { pluginsCall, type PluginsView } from "./PluginsSection";
import { makeInBlenderPrompt, openIfcPrompt, type IfcAction } from "@/lib/blender-pure";

// Entry points into CORE with the Blender plugin (plugins.ts): they only write the request; CORE does the work behind decide().
function useBlender() {
  const [v, setV] = useState<PluginsView | null>(null);
  useEffect(() => { pluginsCall().then(setV, () => {}); }, []);
  const p = v?.plugins.find((x) => x.name === "blender");
  return { ready: !!p?.enabled && p.tools.length > 0, vault: v?.vault ?? "", known: !!v };
}

const SETUP = "Blender isn't connected yet: run tools\\blender\\setup.ps1, open Blender (N → BlenderMCP → Connect), then Profile → Plugins → blender → Test connection.";
const ask = (text: string) => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));

/** GAME DEV: describe a model → CORE builds it in Blender and exports .fbx/.glb into VAULT, with Roblox import steps. */
export function MakeInBlender() {
  const b = useBlender();
  const [desc, setDesc] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="card space-y-1.5 text-xs" aria-label="Make in Blender">
      <div className="muted text-[10px] uppercase tracking-widest">Make in Blender</div>
      <p className="muted">CORE models it in your Blender and exports .fbx + .glb to VAULT for Roblox&apos;s Import 3D. Code runs only after your Run click in Profile → Plugins.</p>
      {b.known && !b.ready && <p className="text-amber-400">{SETUP}</p>}
      <textarea className="field h-16 w-full" maxLength={1500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="a low-poly wooden treasure chest with gold trim" aria-label="Model description" />
      <input className="field w-full" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="file name, e.g. treasure_chest" aria-label="Model name" />
      <button className="chip" disabled={!b.ready || !desc.trim()} onClick={() => ask(makeInBlenderPrompt(desc, name || desc.split(/\s+/).slice(-2).join("_"), b.vault))}>Make in Blender</button>
    </div>
  );
}

/** ARCH: open an IFC file from this PC in Blender + Bonsai: inspect it, or export it to .glb in VAULT. */
export function OpenInBlender() {
  const b = useBlender();
  const [file, setFile] = useState("");
  const [action, setAction] = useState<IfcAction>("inspect");
  const prompt = openIfcPrompt(file, action, b.vault);
  return (
    <div className="card space-y-1.5 text-xs" aria-label="Open in Blender/Bonsai">
      <div className="muted text-[10px] uppercase tracking-widest">Open in Blender / Bonsai</div>
      {b.known && !b.ready && <p className="text-amber-400">{SETUP}</p>}
      <input className="field w-full" value={file} onChange={(e) => setFile(e.target.value)} placeholder="full path of the .ifc on this PC, e.g. C:\Users\you\Documents\house.ifc" aria-label="IFC file path" />
      <select value={action} onChange={(e) => setAction(e.target.value as IfcAction)} aria-label="What to do">
        <option value="inspect">Open and inspect</option><option value="glb">Open and export .glb to VAULT</option>
      </select>{" "}
      <button className="chip" disabled={!b.ready || !prompt} onClick={() => ask(prompt)}>Open in Blender</button>
    </div>
  );
}
