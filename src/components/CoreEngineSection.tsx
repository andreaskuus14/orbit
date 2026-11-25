"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";

const OPTIONS = [
  { id: "cli", label: "ceng.cli", detail: "ceng.cliD" },
  { id: "mcp", label: "ceng.mcp", detail: "ceng.mcpD" },
  { id: "sdk", label: "ceng.sdk", detail: "ceng.sdkD" },
] as const;

/** Profile → CORE engine: which engine answers the next CORE message (core-engine.ts). */
export function CoreEngineSection() {
  const { t } = useT();
  const [v, setV] = useState<{ engine: string; fallback: string; model?: string } | null>(null);
  const [err, setErr] = useState("");
  const call = async (init?: RequestInit) => {
    setErr("");
    const r = await fetch("/api/core/engine", init).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) setV(j); else setErr(t("ceng.loadFail"));
  };
  useEffect(() => { void call(); }, []);
  const pick = (engine: string | null) => void call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine }) });
  return (
    <section className="space-y-2" aria-labelledby="engine-title">
      <h3 id="engine-title" className="text-sm font-semibold">{t("ceng.title")}</h3>
      <p className="muted text-sm">{t("ceng.active")} <b>{(() => { const o = OPTIONS.find((x) => x.id === v?.engine); return o ? t(o.label) : "…"; })()}</b>. {t("ceng.applies")}</p>
      <div role="radiogroup" aria-labelledby="engine-title" className="space-y-1">
        {OPTIONS.map((o) => (
          <button key={o.id} role="radio" aria-checked={v?.engine === o.id} className={`${v?.engine === o.id ? "btn" : "chip"} w-full text-left`} onClick={() => pick(o.id)} disabled={!v}>
            {t(o.label)}<span className="muted block text-xs">{t(o.detail)}</span>
          </button>
        ))}
      </div>
      {v?.engine === "mcp" && (
        <label className="block text-sm">{t("ceng.model")}{" "}
          <select className="chip" value={v.model ?? "auto"} onChange={(e) => void call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: e.target.value }) })}>
            <option value="auto">{t("ceng.auto")}</option>
            <option value="opus">{t("ceng.always", { m: "Opus" })}</option>
            <option value="sonnet">{t("ceng.always", { m: "Sonnet" })}</option>
          </select>
        </label>
      )}
      {v && v.engine !== v.fallback && <button className="btn text-xs" onClick={() => pick(null)}>{t("ceng.back", { name: (() => { const o = OPTIONS.find((x) => x.id === v.fallback); return o ? t(o.label) : v.fallback; })() })}</button>}
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
    </section>
  );
}
