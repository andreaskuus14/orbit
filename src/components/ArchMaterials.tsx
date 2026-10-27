"use client";
// ARCH materials lab: a materials library (Estonian prices, λ/U, ICE v3 carbon), two layer schemes compared side by side on the
// model's areas, and "Refresh prices" that reads product pages read-only and shows changes for the owner to accept. Math in
// arch-materials-pure.ts. Teaching estimates only.
import { Fragment, useEffect, useState } from "react";
import type { Boq } from "@/lib/arch-pure";
import { loadLab, priceChanges, schemeTotals, SLOTS, type Layer, type Material, type PriceChange, type Scheme, type Slot } from "@/lib/arch-materials-pure";

const KEY = "orbit.arch.lab.v1";
const eur = (n: number) => n.toLocaleString("et-EE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const kg = (n: number) => `${Math.round(n).toLocaleString("en")} kg`;
const SLOT_LABEL: Record<Slot, string> = { wall: "Walls", slab: "Slabs", roof: "Roof", window: "Windows" };
const today = () => new Date().toISOString().slice(0, 10);

export function ArchMaterials({ q }: { q: Boq }) {
  const [lab, setLab] = useState(() => loadLab(null));
  const [ready, setReady] = useState(false), [edit, setEdit] = useState(0);
  const [changes, setChanges] = useState<PriceChange[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => { try { setLab(loadLab(JSON.parse(localStorage.getItem(KEY) ?? "null"))); } catch { /* bad JSON: seeds */ } setReady(true); }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(KEY, JSON.stringify(lab)); } catch { /* private mode */ } }, [lab, ready]);

  const { mats, schemes } = lab, totals = schemes.map((s) => schemeTotals(s, q, mats));
  const setMat = (id: string, p: Partial<Material>) => setLab((l) => ({ ...l, mats: l.mats.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
  const setScheme = (i: number, p: Partial<Scheme>) => setLab((l) => ({ ...l, schemes: l.schemes.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const s = schemes[edit];
  const setLayers = (slot: (typeof SLOTS)[number], f: (ls: Layer[]) => Layer[]) => setScheme(edit, { [slot]: f(s[slot]) });

  async function refresh() {
    const items = mats.filter((m) => m.url).map((m) => ({ id: m.id, url: m.url }));
    setBusy(true); setMsg(""); setChanges([]);
    try {
      const r = await fetch("/api/arch/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      const c = priceChanges(mats, j.found ?? []);
      setChanges(c);
      const failed = (j.failed ?? []) as { id: string; error: string }[];
      setMsg(`${c.length ? `${c.length} price${c.length === 1 ? "" : "s"} changed: accept the ones you trust.` : "No price changes."}${failed.length ? ` Couldn't read: ${failed.map((f) => `${mats.find((m) => m.id === f.id)?.label} (${f.error})`).join("; ")}.` : ""}`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const accept = (c: PriceChange) => { setMat(c.id, { eur: c.next, priceSource: `read from ${new URL(c.url).hostname}`, priceDate: today() }); setChanges((cs) => cs.filter((x) => x.id !== c.id)); };

  const matOptions = (unitFilter?: (m: Material) => boolean) => mats.filter(unitFilter ?? (() => true)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>);
  const uCell = (u: number | null, target: number) => u === null ? <span className="muted">—</span>
    : <span className={u <= target ? "ok" : "error"} title={`Teaching target ≤ ${target}`}>{u.toFixed(2)}{u <= target ? " ✓" : " ✗"}</span>;

  return (
    <div className="card space-y-2" aria-label="Materials lab">
      <div className="muted text-[10px] uppercase tracking-widest">Materials lab · two schemes on this model</div>
      <table className="w-full text-xs"><thead><tr className="muted text-left"><th>Part</th><th className="text-right">m²</th>
        {schemes.map((sc, i) => <th key={i} className="text-right" colSpan={3}>{sc.name}</th>)}</tr>
        <tr className="muted text-[10px]"><th /><th />{schemes.map((_, i) => <Fragment key={i}><th className="text-right">€</th><th className="text-right">kgCO₂e</th><th className="text-right">U</th></Fragment>)}</tr></thead>
        <tbody>{totals[0].rows.map((r, k) => (
          <tr key={r.slot}><td>{SLOT_LABEL[r.slot]}</td><td className="num text-right">{r.area}</td>
            {totals.map((t, i) => <Fragment key={i}><td className="num text-right" title={`${t.rows[k].eurM2} €/m²`}>{eur(t.rows[k].cost)}</td>
              <td className="num text-right" title={`${t.rows[k].co2M2} kgCO₂e/m²`}>{kg(t.rows[k].co2)}</td><td className="num text-right">{uCell(t.rows[k].u, r.target)}</td></Fragment>)}</tr>))}
          <tr className="font-semibold"><td colSpan={2}>Total</td>{totals.map((t, i) => <Fragment key={i}><td className="num text-right">{eur(t.cost)}</td><td className="num text-right">{kg(t.co2)}</td><td /></Fragment>)}</tr>
        </tbody></table>
      <p className="muted text-[11px]">Teaching estimate. U targets (wall 0.17, roof 0.12, slab 0.15, window 0.8 W/m²K) are typical of Estonian nZEB houses; the real nZEB test is the whole-building energy figure (ETA), not per-element U. Carbon is ICE v3.0 cradle-to-gate (A1-A3), biogenic carbon not counted. Envelope only: foundation, labour and doors aren&apos;t in it; ground under the slab and thermal bridges are ignored.</p>

      <div className="flex flex-wrap gap-1.5">{schemes.map((sc, i) => <button key={i} className="chip" aria-pressed={edit === i} onClick={() => setEdit(i)}>Edit {sc.name}</button>)}</div>
      <input className="field w-full" value={s.name} maxLength={40} aria-label="Scheme name" onChange={(e) => setScheme(edit, { name: e.target.value })} />
      {SLOTS.map((slot) => (
        <div key={slot} className="space-y-1">
          <div className="text-xs font-semibold">{SLOT_LABEL[slot]} · outside → inside</div>
          {s[slot].map((l, i) => {
            const m = mats.find((x) => x.id === l.mat);
            return <div key={i} className="flex items-center gap-1.5">
              <select className="field flex-1" value={l.mat} aria-label={`${SLOT_LABEL[slot]} layer ${i + 1} material`} onChange={(e) => setLayers(slot, (ls) => ls.map((x, j) => (j === i ? { ...x, mat: e.target.value } : x)))}>{matOptions((x) => !x.u)}</select>
              {m?.unit === "m3" ? <input className="field w-16 text-right" type="number" min={0} max={2000} step={10} value={Math.round(l.t * 1000)} aria-label={`${SLOT_LABEL[slot]} layer ${i + 1} thickness in mm`}
                onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 2000) setLayers(slot, (ls) => ls.map((x, j) => (j === i ? { ...x, t: v / 1000 } : x))); }} /> : <span className="muted w-16 text-right text-[11px]">per m²</span>}
              <span className="muted text-[11px]">{m?.unit === "m3" ? "mm" : ""}</span>
              <button className="chip" aria-label={`Remove ${SLOT_LABEL[slot]} layer ${i + 1}`} onClick={() => setLayers(slot, (ls) => ls.filter((_, j) => j !== i))}>×</button>
            </div>;
          })}
          {s[slot].length < 8 && <button className="chip" onClick={() => setLayers(slot, (ls) => [...ls, { mat: "mwool", t: 0.1 }])}>+ Layer</button>}
        </div>))}
      <label className="flex items-center gap-1.5 text-xs">Windows <select className="field flex-1" value={s.window} onChange={(e) => setScheme(edit, { window: e.target.value })}>{matOptions((x) => !!x.u)}</select></label>

      <details className="space-y-1">
        <summary className="cursor-pointer text-xs">Library · prices, thermal data, carbon</summary>
        <table className="w-full text-xs"><thead><tr className="muted text-left"><th>Material</th><th className="text-right">€/unit</th><th className="text-right">λ / U</th><th className="text-right">kgCO₂e</th></tr></thead>
          <tbody>{mats.map((m) => (
            <tr key={m.id}>
              <td title={`Price: ${m.priceSource}${m.priceDate ? ` · ${m.priceDate}` : ""}`}>{m.label}</td>
              <td className="num text-right"><input className="field w-16 text-right" type="number" min={0} step={1} value={m.eur} aria-label={`${m.label} price per ${m.unit}`}
                onChange={(e) => { const v = Number(e.target.value); if (v >= 0) setMat(m.id, { eur: v, priceSource: "your edit", priceDate: today() }); }} /> /{m.unit === "m3" ? "m³" : "m²"}</td>
              <td className="num text-right">{m.u ? `U ${m.u}` : m.lambda ? `λ ${m.lambda}` : "—"}</td>
              <td className="num text-right" title={m.carbonSource}>{m.co2}/{m.unit === "m3" ? "m³" : "m²"}</td>
            </tr>))}</tbody></table>
        <p className="muted text-[11px]">Seed prices dated {mats[0].priceDate || "—"} are estimates, not read from a shop; hover a name for its source, a carbon figure for its ICE v3.0 entry. Check carbon values against the database before citing them.</p>
        <div className="text-xs font-semibold">Price pages (optional, for Refresh)</div>
        {mats.map((m) => <div key={m.id} className="flex items-center gap-1.5">
          <span className="w-32 truncate text-[11px]" title={m.label}>{m.label}</span>
          <input className="field flex-1" type="url" placeholder="https://… product page" value={m.url ?? ""} aria-label={`${m.label} product page URL`} onChange={(e) => setMat(m.id, { url: e.target.value.trim() || undefined })} />
          <input className="field w-16 text-right" type="number" min={0} step={0.001} value={m.per ?? 1} aria-label={`${m.label}: ${m.unit} that one listed price buys`} title={`How many ${m.unit} one listed price buys (a 600×200×300 block = 0.036 m³)`}
            onChange={(e) => { const v = Number(e.target.value); if (v > 0) setMat(m.id, { per: v }); }} />
        </div>)}
      </details>
      <button className="chip" disabled={busy || !mats.some((m) => m.url)} onClick={() => void refresh()} title="Reads the product pages you added, read-only, and shows what changed">{busy ? "Reading…" : "↻ Refresh prices"}</button>
      {msg && <p className="text-xs" aria-live="polite">{msg}</p>}
      {changes.length > 0 && <ul className="space-y-1">
        {changes.map((c) => <li key={c.id} className="flex items-center justify-between gap-1.5 text-xs">
          <span>{c.label}: {c.old} → <b>{c.next}</b> €/{c.unit === "m3" ? "m³" : "m²"}</span>
          <span className="flex gap-1"><button className="chip ok" onClick={() => accept(c)}>Accept</button><button className="chip" onClick={() => setChanges((cs) => cs.filter((x) => x.id !== c.id))}>Skip</button></span></li>)}
        {changes.length > 1 && <li><button className="chip" onClick={() => changes.forEach(accept)}>Accept all</button></li>}
      </ul>}
    </div>
  );
}
