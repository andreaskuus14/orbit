"use client";
import { useEffect, useState } from "react";
import type { CoreConfig } from "@/lib/core-capability-pure";

/** DEV world: the effective CORE setup (GET /api/core), so a weaker model or a low cap is visible, never silent. */
export default function CoreConfigPanel() {
  const [c, setC] = useState<CoreConfig | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/core", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Failed (${r.status})`); setC(j); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  if (err) return <p className="error">{err}</p>;
  if (!c) return <p className="muted">Loading CORE config…</p>;
  const rows: [string, string][] = [
    ["Auth", c.auth], ["CLI", c.bin],
    ["Models", `main ${c.models.main} · fast ${c.models.fast} · deep ${c.models.deep} (effort ${c.deepEffort}) · smart ${c.models.smart}`],
    ["Tool loop", `${c.maxSteps} model steps (${c.maxSteps - 1} tools) · tool results cut at ${c.toolResultChars} chars`],
    ["Budget", `${c.turnBudgetS} s per turn · ${c.callTimeoutS} s per call · ${c.concurrency} CLIs at once`],
    ["History", `last ${c.historyFull} messages in full, older ones abbreviated`],
    ["Session", c.session], ["Tools", c.tools], ["Voice", c.voice],
  ];
  return (
    <section aria-label="CORE config">
      <div className="hud-title">CORE CONFIG</div>
      <dl className="mt-2 space-y-1 text-xs">
        {rows.map(([k, v]) => <div key={k}><dt className="muted inline">{k}: </dt><dd className="inline">{v}</dd></div>)}
      </dl>
    </section>
  );
}
