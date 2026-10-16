"use client";
import { useCallback, useEffect, useState } from "react";
import type { BuildResult, Item, PlanResult } from "@/lib/roblox-pure";

const PINK = "#f472b6";
const OPEN_STUDIO = "Open Roblox Studio with your place and enable the MCP plugin, then check again.";
type Status = { configured: boolean; help?: string; studio?: { open: boolean; place: string; notes: string } };
type Plan = PlanResult & { planId: string; expiresAt: number };
type Built = BuildResult & { image: string | null };

async function call<T>(init?: RequestInit, query = ""): Promise<T> {
  const res = await fetch(`/api/roblox${query}`, { cache: "no-store", headers: { "content-type": "application/json" }, ...init });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 || res.status === 403) throw new Error("You're signed out. Reload ORBIT and sign in.");
  if (!res.ok) throw new Error(j.error || `Request failed (error ${res.status}).`);
  return j;
}

const describe = (item: Item) => (item.kind === "asset" ? `${item.name} (asset ${item.assetId})` : `Generate: “${item.prompt}”`);

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

        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}
