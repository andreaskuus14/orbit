"use client";
import { useMemo, useState } from "react";
import type { PlanResult, ScenePlan } from "@/lib/roblox-pure";
import { PINK, ScanPanel, call, scanTargets, type Built } from "./RobloxBuild";

type Plan = PlanResult & { planId: string; expiresAt: number; scene?: ScenePlan; thumbs?: Record<string, string> };
const btn = { background: `linear-gradient(90deg, ${PINK}, #db2777)`, boxShadow: `0 0 18px ${PINK}55` };
const v3 = (v: number[]) => v.map((n) => Math.round(n)).join(", ");

/** GAME DEV → Scene from a sentence: plan (read-only, Creator Store search) → untick objects → build only the ticked ones → auto free-model scan. */
export default function ScenePlanner() {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<"" | "plan" | "build">("");
  const [err, setErr] = useState("");
  const text = prompt.trim();

  const doPlan = async () => {
    setBusy("plan"); setErr(""); setPlan(null); setBuilt(null);
    try {
      const p = await call<Plan>({ method: "POST", body: JSON.stringify({ action: "plan", item: { kind: "scene", prompt: text } }) });
      if (!p.ready || !p.scene) setErr(p.notes || "Studio isn't ready. Open Roblox Studio with your place and enable the MCP plugin.");
      else { setPlan(p); setTicked(p.scene.objects.map(() => true)); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const doBuild = async () => {
    if (!plan) return;
    if (Date.now() > plan.expiresAt) { setErr("This plan expired (plans last 10 minutes). Make a new plan."); setPlan(null); return; }
    setBusy("build"); setErr("");
    try {
      const keep = ticked.flatMap((t, i) => (t ? [i] : []));
      setBuilt(await call<Built>({ method: "POST", body: JSON.stringify({ action: "build", planId: plan.planId, keep }) }));
      setPlan(null); // plans are single use
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const autoScan = useMemo(() => (built?.done ? scanTargets(built) : null), [built]);
  const count = ticked.filter(Boolean).length;

  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44`, maxWidth: 420 }} aria-label="Scene from a sentence">
      <h3 className="brand text-sm" style={{ color: PINK }}>Scene from a sentence</h3>
      <textarea className="field text-xs" rows={2} maxLength={200} value={prompt} onChange={(e) => { setPrompt(e.target.value); setPlan(null); }}
        placeholder="A cosy campsite with a tent, a campfire and pine trees by a lake" aria-label="Describe the scene" />
      <button className="btn" style={btn} onClick={doPlan} disabled={!!busy || text.length < 3}>
        {busy === "plan" ? "Planning (looks only, up to 2 min)…" : "Plan scene"}
      </button>

      {plan?.scene && (
        <div className="rounded-lg border p-2" style={{ borderColor: `${PINK}55` }}>
          <p className="mb-1 text-xs"><b>{plan.scene.scene}</b>{plan.place && <> in <b>{plan.place}</b></>} · origin {v3(plan.scene.origin)}. Untick what you don&apos;t want:</p>
          <table className="w-full text-[11px]">
            <thead className="muted text-left"><tr><th /><th /><th>Object</th><th>Offset (studs)</th></tr></thead>
            <tbody>
              {plan.scene.objects.map((o, i) => {
                const img = plan.thumbs?.[o.assetId];
                return (
                  <tr key={o.assetId} style={{ opacity: ticked[i] ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={!!ticked[i]} aria-label={`Include ${o.name}`} disabled={!!busy}
                      onChange={(e) => setTicked((t) => t.map((x, j) => (j === i ? e.target.checked : x)))} /></td>
                    <td className="w-9">{img?.startsWith("https://") && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" width={32} height={32} className="rounded" loading="lazy" referrerPolicy="no-referrer" />
                    )}</td>
                    <td><b>{o.name}</b><br /><a className="muted font-mono" href={`https://create.roblox.com/store/asset/${o.assetId}`} target="_blank" rel="noreferrer noopener">{o.assetId}</a></td>
                    <td className="font-mono">{v3(o.position)}{o.rotation.some(Boolean) && <span className="muted"> ⟳{v3(o.rotation)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {plan.notes && <p className="muted mt-1 text-[11px]">{plan.notes}</p>}
          <p className="muted mt-1 text-[11px]">Studio&apos;s insert tool can&apos;t set positions, so objects land at the default spot; use the offsets to arrange them.</p>
          <div className="mt-2 flex gap-2">
            <button className="btn" style={btn} onClick={doBuild} disabled={!!busy || !count}>
              {busy === "build" ? "Building (up to 4 minutes)…" : `Build scene (${count})`}
            </button>
            <button className="chip" onClick={() => setPlan(null)} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}

      {built && (
        <div className="rounded-lg border p-2 text-xs" style={{ borderColor: built.done ? "rgba(110,231,183,0.4)" : "rgba(251,113,133,0.4)" }}>
          <p style={{ color: built.done ? "var(--mint)" : "var(--rose)" }}><b>{built.done ? "Scene built in Studio." : "Not finished."}</b></p>
          {built.inserted.length > 0 && (
            <ul className="mt-1 text-[11px]">{built.inserted.map((x, i) => <li key={i}><b>{x.name}</b> <span className="muted font-mono">{x.path}</span></li>)}</ul>
          )}
          {built.notes && <p className="muted mt-1 text-[11px]">{built.notes}</p>}
          {built.image?.startsWith("data:image/png;base64,") && built.image.length < 3_100_000 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={built.image} alt="Screenshot of Roblox Studio after the build" className="mt-2 w-full rounded-md" />
          )}
        </div>
      )}

      <ScanPanel autoPaths={autoScan} />
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
