"use client";
import { useCallback, useEffect, useState } from "react";

type Place = { name: string; lat: number; lon: number; pc?: boolean };
type View = { on: boolean; places: Place[]; last: { at: string; near: string | null } | null };

/** Profile → Location-aware brief: opt-in switch (off by default), saved places, and one button to forget the latest point. */
export function PlaceSection() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [pc, setPc] = useState(false);
  const call = useCallback(async (method: "GET" | "POST" | "DELETE" = "GET", body?: object) => {
    setErr("");
    const r = await fetch("/api/place", { method, ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) { setV(j); return true; }
    setErr(j?.error ?? "Couldn't load location settings");
    return false;
  }, []);
  useEffect(() => { void call(); }, [call]);
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (await call("POST", { saveHere: name, pc })) { setName(""); setPc(false); } };
  return (
    <section className="space-y-3" aria-labelledby="place-title">
      <h3 id="place-title" className="text-sm font-semibold">Location-aware brief</h3>
      <p className="muted text-sm">
        Off unless you turn it on. When on, the phone remote sends a rough location (rounded to about 1 km) only when you tap <b>Update place</b> there:
        no background tracking, and only the latest point is kept, in ORBIT's data folder on this PC. The morning brief then may add a line like
        “you're near School, and … is waiting” or “you're away from your PC, 3 things need it”. Your location never goes to an AI model; only a place name you saved can appear in the brief.
        Weather: if you saved a place marked “my PC is here” (or the phone is near a saved place while this is on), the brief adds one line like
        “around Home today: 4 to 9 degrees, rain after 15:00”. Once a morning ORBIT asks Open-Meteo (free, no account) for that place's
        coordinates rounded to about 10 km; nothing else is sent. No saved place, no weather.
      </p>
      {v && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.on} onChange={(e) => void call("POST", { on: e.target.checked })} /> Use my phone's rough location in the brief
      </label>}
      {v?.on && <>
        <p className="muted text-sm">{v.last ? `Latest point: ${new Date(v.last.at).toLocaleString()}${v.last.near ? `, near ${v.last.near}` : ""}.` : "No point from the phone yet."}</p>
        {v.last && <button className="chip" onClick={() => void call("DELETE")}>Delete my location</button>}
        <ul className="space-y-1">
          {v.places.map((p) => (
            <li key={p.name} className="flex items-center gap-2 text-sm">
              <span>{p.name}{p.pc ? " (PC here)" : ""}</span>
              <button className="chip" aria-label={`Remove ${p.name}`} onClick={() => void call("POST", { places: v.places.filter((x) => x !== p) })}>Remove</button>
            </li>
          ))}
        </ul>
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input className="field" placeholder="Home, School, Studio…" maxLength={30} required aria-label="Place name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={pc} onChange={(e) => setPc(e.target.checked)} /> my PC is here</label>
          <button className="btn" disabled={!v.last || !name.trim()}>Save the phone's latest point</button>
        </form>
      </>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
