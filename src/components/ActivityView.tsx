"use client";
import { useCallback, useEffect, useState } from "react";
import { ACT_AREAS, type ActItem } from "@/lib/activity-pure";
import { NAV_EVENT } from "@/lib/nav-pure";
import type { PanelId } from "@/lib/planets";

const LABEL: Record<string, string> = { agents: "Agents", chains: "Teams", goals: "Goals", automations: "Automations", autopilot: "Autopilot", clips: "Uploads", core: "CORE", system: "System" };

/** OPERATIONS → Activity: what ORBIT did lately, across the system (read-only, newest first). */
export function ActivityView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [area, setArea] = useState("");
  const [items, setItems] = useState<ActItem[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/activity${area ? `?area=${area}` : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setItems(j.items); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, [area]);
  useEffect(() => { void load(); const h = setInterval(() => void load(), 45_000); return () => clearInterval(h); }, [load]);

  const open = (x: ActItem) => {
    if (x.link?.task) onOpenTask(x.link.task);
    else if (x.link?.panel) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: x.link.panel as PanelId } }));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by area">
        {["", ...ACT_AREAS].map((a) => (
          <button key={a || "all"} className="chip" aria-pressed={area === a} style={area === a ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setArea(a)}>{a ? LABEL[a] : "All"}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!items ? <p className="muted">Loading…</p> : (
        <ul className="space-y-1.5">
          {items.map((x, i) => (
            <li key={`${x.at}-${i}`}>
              <button className="card w-full text-left" onClick={() => open(x)} disabled={!x.link} title={x.link ? "Open" : undefined}>
                <div className="text-sm">{x.title}</div>
                <div className="muted text-xs">{LABEL[x.area]} · {new Date(x.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{x.detail ? ` · ${x.detail}` : ""}</div>
              </button>
            </li>
          ))}
          {!items.length && <li className="muted text-sm">Nothing yet.</li>}
        </ul>
      )}
    </div>
  );
}
