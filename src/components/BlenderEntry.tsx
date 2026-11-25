"use client";
import { useEffect, useState } from "react";
import { VOICE_ASK } from "./voice/bus";
import { useT } from "./i18n";
import { pluginsCall, type PluginsView } from "./PluginsSection";
import { makeInBlenderPrompt, openIfcPrompt, type IfcAction } from "@/lib/blender-pure";

// Entry points into CORE with the Blender plugin (plugins.ts): they only write the request; CORE does the work behind decide().
function useBlender() {
  const [v, setV] = useState<PluginsView | null>(null);
  useEffect(() => { pluginsCall().then(setV, () => {}); }, []);
  const p = v?.plugins.find((x) => x.name === "blender");
  return { ready: !!p?.enabled && p.tools.length > 0, vault: v?.vault ?? "", known: !!v };
}

const ask = (text: string) => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));

/** GAME DEV: describe a model → CORE builds it in Blender and exports .fbx/.glb into VAULT, with Roblox import steps. */
export function MakeInBlender() {
  const { t } = useT();
  const b = useBlender();
  const [desc, setDesc] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="card space-y-1.5 text-xs" aria-label={t("blend.make")}>
      <div className="muted text-[12px] font-medium">{t("blend.make")}</div>
      <p className="muted">{t("blend.makeHelp")}</p>
      {b.known && !b.ready && <p className="text-amber-400">{t("blend.setup")}</p>}
      <textarea className="field h-16 w-full" maxLength={1500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("blend.descPh")} aria-label={t("blend.desc")} />
      <input className="field w-full" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("blend.namePh")} aria-label={t("blend.name")} />
      <button className="chip" disabled={!b.ready || !desc.trim()} onClick={() => ask(makeInBlenderPrompt(desc, name || desc.split(/\s+/).slice(-2).join("_"), b.vault))}>{t("blend.make")}</button>
    </div>
  );
}

/** ARCH: open an IFC file from this PC in Blender + Bonsai: inspect it, or export it to .glb in VAULT. */
export function OpenInBlender() {
  const { t } = useT();
  const b = useBlender();
  const [file, setFile] = useState("");
  const [action, setAction] = useState<IfcAction>("inspect");
  const prompt = openIfcPrompt(file, action, b.vault);
  return (
    <div className="card space-y-1.5 text-xs" aria-label={t("blend.openBonsai")}>
      <div className="muted text-[12px] font-medium">{t("blend.openBonsai")}</div>
      {b.known && !b.ready && <p className="text-amber-400">{t("blend.setup")}</p>}
      <input className="field w-full" value={file} onChange={(e) => setFile(e.target.value)} placeholder={t("blend.ifcPh")} aria-label={t("blend.ifc")} />
      <select value={action} onChange={(e) => setAction(e.target.value as IfcAction)} aria-label={t("blend.action")}>
        <option value="inspect">{t("blend.inspect")}</option><option value="glb">{t("blend.export")}</option>
      </select>{" "}
      <button className="chip" disabled={!b.ready || !prompt} onClick={() => ask(prompt)}>{t("blend.open")}</button>
    </div>
  );
}
