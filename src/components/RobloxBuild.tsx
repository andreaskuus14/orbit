"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BuildResult, Item, PlanResult, ScanResult } from "@/lib/roblox-pure";

export const PINK = "#f472b6";
const OPEN_STUDIO = "Open Roblox Studio with your place and enable the MCP plugin, then check again.";
type Status = { configured: boolean; help?: string; studio?: { open: boolean; place: string; notes: string } };
type Plan = PlanResult & { planId: string; expiresAt: number };
export type Built = BuildResult & { image: string | null; historyId?: string };

export async function call<T>(init?: RequestInit, query = ""): Promise<T> {
  const res = await fetch(`/api/roblox${query}`, { cache: "no-store", headers: { "content-type": "application/json" }, ...init });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 || res.status === 403) throw new Error("You're signed out. Reload ORBIT and sign in.");
  if (!res.ok) throw new Error(j.error || `Request failed (error ${res.status}).`);
  return j;
}

const describe = (item: Item) =>
  item.kind === "asset" ? `${item.name} (asset ${item.assetId})`
  : item.kind === "texture" ? `Re-texture ${item.target || "the selected mesh"}: “${item.prompt}”`
  : item.kind === "material" ? `Material${item.base ? ` (${item.base})` : ""}: “${item.prompt}”`
  : item.kind === "scene" ? `Scene: “${item.prompt}”`
  : `Generate: “${item.prompt}”`;

/** Paths to scan after a build: what it reported inserting (the server keeps only Workspace paths). */
export const scanTargets = (b: Built) => b.inserted.map((x) => x.path).filter(Boolean);

/** Read-only free-model check. Runs whenever `autoPaths` changes to a new array (memoise it!) (after a build) and on the button. ORBIT never deletes anything. */
export function ScanPanel({ autoPaths }: { autoPaths: string[] | null }) {
  const [res, setRes] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = useCallback(async (paths?: string[]) => {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await call<ScanResult>({ method: "POST", body: JSON.stringify({ action: "scan", paths }) })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (autoPaths) void run(autoPaths); }, [autoPaths, run]);

  const ok = res?.done && res.clean;
  return (
    <div className="rounded-lg border p-2 text-xs" style={{ borderColor: `${PINK}44` }} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <b style={{ color: PINK }}>Free-model scan</b>
        <button className="chip" onClick={() => run()} disabled={busy}>{busy ? "Scanning (read-only, up to 3 min)…" : "Scan ORBIT Builds"}</button>
      </div>
      {res && !res.done && <p className="muted mt-1">{res.notes || "The scan didn't finish."}</p>}
      {res?.done && (
        <div className="mt-1 grid gap-1">
          <p style={{ color: ok ? "var(--mint)" : "#fbbf24" }}>
            <b>{ok ? "No risky code reported" : "⚠️ Risky"}</b> · {res.parts} parts · {res.meshes} meshes · {res.scripts} scripts · lag risk {res.lag}
          </p>
          {ok && <p className="muted text-[11px]">A model read these scripts; it can be fooled.</p>}
          {!!res.raw?.length && (
            <div>
              <p className="muted text-[11px]">ORBIT&apos;s own pattern check of the raw script text matched these lines (they may be in scripts outside the scanned folder):</p>
              {res.raw.map((l, i) => <code key={i} className="block whitespace-pre-wrap break-all text-[11px]">{l}</code>)}
            </div>
          )}
          {res.lag === "high" && <p className="muted">That&apos;s a lot of parts: it may lag on phones.</p>}
          {res.findings.length > 0 && (
            <>
              <ul className="grid gap-1">
                {res.findings.map((f, i) => (
                  <li key={i} className="rounded-md p-1" style={{ background: f.level === "high" ? "rgba(251,113,133,0.12)" : "rgba(251,191,36,0.10)" }}>
                    <span className="font-mono text-[11px]">{f.script}{f.line ? `:${f.line}` : ""}</span> <span className="muted">· {f.label}</span>
                    <code className="mt-0.5 block whitespace-pre-wrap break-all text-[11px]">{f.excerpt}</code>
                  </li>
                ))}
              </ul>
              <p><b>Delete these scripts in Studio before publishing.</b> <span className="muted">ORBIT only reads; it doesn&apos;t delete anything.</span></p>
            </>
          )}
          {res.notes && <p className="muted">{res.notes}</p>}
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** Put an item into the owner's open Roblox Studio place: check status → Plan (dry run) → review → Build it → result. */
export default function RobloxBuild({ item, onDone }: { item: Item | null; onDone?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<"" | "status" | "plan" | "build">("");
  const [err, setErr] = useState("");

  const check = useCallback(async () => {
    setBusy("status"); setErr("");
    try { setStatus(await call<Status>(undefined, "?status=1")); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  const itemKey = JSON.stringify(item); // parents may pass a fresh object each render
  useEffect(() => { setPlan(null); setBuilt(null); setErr(""); }, [itemKey]);

  const doPlan = async () => {
    if (!item) return;
    setBusy("plan"); setErr(""); setPlan(null); setBuilt(null);
    try {
      const p = await call<Plan>({ method: "POST", body: JSON.stringify({ action: "plan", item }) });
      setPlan(p);
      if (!p.ready) setErr(`${p.notes || "Studio isn't ready."} ${OPEN_STUDIO}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const doBuild = async () => {
    if (!plan?.planId) return;
    if (Date.now() > plan.expiresAt) { setErr("This plan expired (plans last 10 minutes). Make a new plan."); setPlan(null); return; }
    setBusy("build"); setErr("");
    try {
      const b = await call<Built>({ method: "POST", body: JSON.stringify({ action: "build", planId: plan.planId }) });
      setBuilt(b); setPlan(null);
      if (b.done) onDone?.();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const autoScan = useMemo(() => (built?.done ? scanTargets(built) : null), [built]); // one scan per finished build
  const studio = status?.studio;
  const btn = { background: `linear-gradient(90deg, ${PINK}, #db2777)`, boxShadow: `0 0 18px ${PINK}55` };

  return (
    <section className="glass rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Build in Roblox Studio">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="brand text-sm" style={{ color: PINK }}>Build in Roblox Studio</h3>
        <button className="chip" onClick={check} disabled={!!busy} aria-label="Check Roblox Studio connection again">
          {busy === "status" ? "Checking…" : "Check again"}
        </button>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {!status ? (busy === "status" && <p className="muted text-xs">Checking Roblox Studio (up to 40 seconds)…</p>)
          : !status.configured ? (
            <div>
              <p className="text-xs"><b>Roblox Studio isn&apos;t connected to ORBIT yet.</b> To set it up:</p>
              <pre className="muted mt-1 whitespace-pre-wrap text-[11px]">{status.help}</pre>
            </div>
          ) : studio && (
            <p className="text-xs" style={{ color: studio.open ? "var(--mint)" : "var(--rose)" }}>
              {studio.open ? `Studio open: ${studio.place || "unnamed place"}` : `Studio not reachable. ${studio.notes} ${OPEN_STUDIO}`}
            </p>
          )}

        {status?.configured && (item ? (
          <>
            <p className="text-xs"><span className="muted">Item:</span> {describe(item)}</p>
            {!plan?.ready && (
              <button className="btn" style={btn} onClick={doPlan} disabled={!!busy}>
                {busy === "plan" ? "Planning (dry run, changes nothing)…" : "Plan it"}
              </button>
            )}
          </>
        ) : <p className="muted text-xs">Pick an item to build.</p>)}

        {plan?.ready && (
          <div className="rounded-lg border p-2" style={{ borderColor: `${PINK}55` }}>
            <p className="mb-1 text-xs"><b>Plan</b>{plan.place && <> for <b>{plan.place}</b></>}. Review it, then build:</p>
            <pre className="whitespace-pre-wrap text-[11px]">{plan.text}</pre>
            {plan.notes && <p className="muted mt-1 text-[11px]">{plan.notes}</p>}
            <div className="mt-2 flex gap-2">
              <button className="btn" style={btn} onClick={doBuild} disabled={!!busy}>{busy === "build" ? "Building (up to 4 minutes)…" : "Build it"}</button>
              <button className="chip" onClick={() => setPlan(null)} disabled={!!busy}>Cancel</button>
            </div>
          </div>
        )}

        {built && (
          <div className="rounded-lg border p-2" style={{ borderColor: built.done ? "rgba(110,231,183,0.4)" : "rgba(251,113,133,0.4)" }}>
            <p className="text-xs" style={{ color: built.done ? "var(--mint)" : "var(--rose)" }}><b>{built.done ? "Built in Studio." : "Not finished."}</b></p>
            {built.inserted.length > 0 && (
              <ul className="mt-1 text-[11px]">
                {built.inserted.map((x, i) => <li key={i}><b>{x.name}</b> <span className="muted font-mono">{x.path}</span></li>)}
              </ul>
            )}
            {built.notes && <p className="muted mt-1 text-[11px]">{built.notes}</p>}
            {built.image?.startsWith("data:image/png;base64,") && built.image.length < 3_100_000 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={built.image} alt="Screenshot of Roblox Studio after the build" className="mt-2 w-full rounded-md" />
            )}
          </div>
        )}

        {status?.configured && item?.kind === "asset" && <ScanPanel autoPaths={autoScan} />}

        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}
