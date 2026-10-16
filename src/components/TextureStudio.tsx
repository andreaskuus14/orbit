"use client";
import { useMemo, useState } from "react";
import { MATERIALS, type Item, type Material } from "@/lib/roblox-pure";
import RobloxBuild, { PINK } from "./RobloxBuild";

const STYLES = ["stylised", "realistic", "low-poly", "cartoon"];

/** GAME DEV → Texture & material studio: a form that hands a texture/material item to RobloxBuild's plan → confirm → build flow. */
export default function TextureStudio() {
  const [kind, setKind] = useState<"texture" | "material">("material");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [base, setBase] = useState<Material | "">("");
  const [target, setTarget] = useState("");

  const item = useMemo<Item | null>(() => {
    const p = [prompt.trim(), style && `${style} style`].filter(Boolean).join(", ");
    if (prompt.trim().length < 3 || p.length > 200) return null;
    if (kind === "material") return base ? { kind, prompt: p, base } : { kind, prompt: p };
    return target.trim() ? { kind, prompt: p, target: target.trim() } : { kind, prompt: p };
  }, [kind, prompt, style, base, target]);
  const on = (a: boolean) => (a ? { borderColor: PINK, color: PINK } : undefined);

  return (
    <section className="grid gap-2 text-sm" style={{ maxWidth: 420 }} aria-label="Texture and material studio">
      <div className="glass grid gap-2 rounded-xl p-3" style={{ borderColor: `${PINK}44` }}>
        <h3 className="brand text-sm" style={{ color: PINK }}>Texture &amp; material studio</h3>
        <div className="flex gap-2" role="group" aria-label="What to make">
          <button className="chip" aria-pressed={kind === "material"} style={on(kind === "material")} onClick={() => setKind("material")}>🧱 Material</button>
          <button className="chip" aria-pressed={kind === "texture"} style={on(kind === "texture")} onClick={() => setKind("texture")}>🎨 Re-texture a mesh</button>
        </div>
        <input className="field text-xs" maxLength={180} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === "material" ? "Mossy cobblestone with cracks" : "Rusty metal with peeling blue paint"} aria-label="Describe the look" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Style">
          {STYLES.map((s) => <button key={s} className="chip" aria-pressed={style === s} style={on(style === s)} onClick={() => setStyle(style === s ? "" : s)}>{s}</button>)}
        </div>
        {kind === "material" ? (
          <label className="text-xs">Base material{" "}
            <select className="field text-xs" value={base} onChange={(e) => setBase(e.target.value as Material | "")}>
              <option value="">Let Studio pick</option>
              {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        ) : (
          <>
            <input className="field font-mono text-xs" maxLength={200} value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder="Workspace.ORBIT Builds.Tree (empty = current selection)" aria-label="Mesh or model to re-texture (path in Workspace)" />
            <p className="muted text-[11px]">Re-texturing replaces that MeshPart/Model in place (Ctrl+Z in Studio undoes it). Only objects inside Workspace.</p>
          </>
        )}
        {kind === "material" && <p className="muted text-[11px]">Creates a MaterialVariant. ORBIT doesn&apos;t apply it: set a part&apos;s Material and MaterialVariant in Studio.</p>}
      </div>
      <RobloxBuild item={item} />
    </section>
  );
}
