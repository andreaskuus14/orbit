"use client";
import { useMemo, useState } from "react";
import { useT } from "./i18n";
import { MATERIALS, type Item, type Material } from "@/lib/roblox-pure";
import RobloxBuild, { PINK } from "./RobloxBuild";

const STYLES = ["stylised", "realistic", "low-poly", "cartoon"];

/** GAME DEV → Texture & material studio: a form that hands a texture/material item to RobloxBuild's plan → confirm → build flow. */
export default function TextureStudio() {
  const { t } = useT();
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
    <section className="grid gap-2 text-sm" style={{ maxWidth: 420 }} aria-label={t("tex.studio")}>
      <div className="glass grid gap-2 rounded-xl p-3" style={{ borderColor: `${PINK}44` }}>
        <h3 className="brand text-sm" style={{ color: PINK }}>{t("tex.title")}</h3>
        <div className="flex gap-2" role="group" aria-label={t("tex.what")}>
          <button className="chip" aria-pressed={kind === "material"} style={on(kind === "material")} onClick={() => setKind("material")}>{t("tex.material")}</button>
          <button className="chip" aria-pressed={kind === "texture"} style={on(kind === "texture")} onClick={() => setKind("texture")}>{t("tex.retex")}</button>
        </div>
        <input className="field text-xs" maxLength={180} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === "material" ? t("tex.matPh") : t("tex.texPh")} aria-label={t("tex.look")} />
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("tex.style")}>
          {STYLES.map((s) => <button key={s} className="chip" aria-pressed={style === s} style={on(style === s)} onClick={() => setStyle(style === s ? "" : s)}>{s}</button>)}
        </div>
        {kind === "material" ? (
          <label className="text-xs">{t("tex.base")}{" "}
            <select className="field text-xs" value={base} onChange={(e) => setBase(e.target.value as Material | "")}>
              <option value="">{t("tex.pick")}</option>
              {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        ) : (
          <>
            <input className="field font-mono text-xs" maxLength={200} value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder={t("tex.targetPh")} aria-label={t("tex.target")} />
            <p className="muted text-[11px]">{t("tex.retexHelp")}</p>
          </>
        )}
        {kind === "material" && <p className="muted text-[11px]">{t("tex.matHelp")}</p>}
      </div>
      <RobloxBuild item={item} />
    </section>
  );
}
