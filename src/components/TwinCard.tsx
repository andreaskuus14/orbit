"use client";
import { useEffect, useState } from "react";
import { KIND_LABEL, TWIN_COLOR, TWIN_GLYPH, type Decision, type TwinView } from "@/lib/twin-pure";

/** The twin's case against a big decision, beside (never in front of) the decide button. Renders nothing when the twin stays quiet. */
export function TwinCard({ decision }: { decision: Decision | null }) {
  const [v, setV] = useState<TwinView | null>(null);
  const [state, setState] = useState<"idle" | "thinking" | "hidden">("idle");
  const key = decision && `${decision.kind}:${decision.ref}`;
  useEffect(() => {
    setV(null);
    if (!decision) return;
    let off = false;
    setState("thinking");
    void fetch("/api/twin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off) { setV(j?.view ?? null); setState("idle"); } }, () => !off && setState("idle"));
    return () => { off = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- one ask per item
  if (!decision || state === "hidden" || (!v && state !== "thinking")) return null;
  const mute = () => { setState("hidden"); void fetch("/api/twin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mute", kind: decision.kind, muted: true }) }); };
  return (
    <aside className="card space-y-2 text-sm" style={{ borderLeft: `3px solid ${TWIN_COLOR}` }} aria-label="Twin: the case against">
      <p className="flex items-center justify-between gap-2">
        <b style={{ color: TWIN_COLOR }}><span aria-hidden>{TWIN_GLYPH}</span> Twin: the case against</b>
        <button className="chip text-xs" onClick={() => setState("hidden")} aria-label="Hide the twin">Hide</button>
      </p>
      {!v ? <p className="muted" role="status">Thinking of the other side… (you don&apos;t have to wait)</p> : (
        <>
          <ol className="list-decimal space-y-1 pl-5">
            {v.risks.map((r, i) => <li key={i}>{r.text}{r.evidence.length > 0 && <span className="muted text-xs"> · ledger {r.evidence.join(", ")}</span>}</li>)}
          </ol>
          <p><b>Best alternative:</b> {v.alternative}</p>
          <p><b>Would change my mind:</b> {v.mindChange}</p>
          <p className="border-t pt-2" style={{ borderColor: "var(--line)" }}>{v.recommendation}</p>
          {decision.kind !== "argue" && <button className="chip text-xs" onClick={mute}>Don&apos;t argue on {KIND_LABEL[decision.kind]}</button>}
        </>
      )}
    </aside>
  );
}
