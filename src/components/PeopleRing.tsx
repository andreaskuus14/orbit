"use client";
// MEMORY → People: his clients, collaborators and friends as moons on a ring. Own canvas, one instanced mesh with one shared
// program (warmed by WarmCompile). Brightness = recency, size = importance, a soft amber halo = important and overdue.
// The panel side (list, card, timeline, check-in draft) is PeoplePanel; state is shared through usePeople. API: /api/people.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { WarmCompile } from "./WarmCompile";
import { useGlRecovery } from "./useGlRecovery";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { AFFINITIES, AFFINITY_COLOR, daysSince, moonSize, recency, ringLayout, type Affinity, type Person, type Touch } from "@/lib/people-pure";

type View = Person & { local: boolean; last: string | null; overdue: boolean };
const API = "/api/people";
const post = async (body: object) => {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
  return j;
};
const ago = (at: string | null) => { const d = daysSince(at, Date.now()); return d === null ? "never" : d === 0 ? "today" : `${d}d ago`; };

/** People list shared by the ring and the panel; loads while `on`. */
export function usePeople(on: boolean) {
  const [people, setPeople] = useState<View[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const reload = useCallback(() => fetch(API).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Could not load people (${r.status})`);
    setPeople(j.people); setErr("");
  }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { if (on) void reload(); }, [on, reload]);
  return { people, err, sel, setSel, reload };
}
export type PeopleState = ReturnType<typeof usePeople>;

const vert = /* glsl */ `
  attribute vec3 aColor; attribute float aBright; attribute float aHalo; attribute float aHi;
  varying vec2 vP; varying vec3 vColor; varying float vBright; varying float vHalo; varying float vHi;
  void main() {
    vP = uv * 2.0 - 1.0; vColor = aColor; vBright = aBright; vHalo = aHalo; vHi = aHi;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const frag = /* glsl */ `
  uniform float uTime;
  varying vec2 vP; varying vec3 vColor; varying float vBright; varying float vHalo; varying float vHi;
  void main() {
    float r = length(vP);
    if (r > 1.0) discard;
    float disc = smoothstep(0.46, 0.42, r);
    vec2 q = vP / 0.44;
    vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
    float lit = 0.3 + 0.7 * max(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0);
    float glow = exp(-max(r - 0.44, 0.0) * 10.0) * (1.0 - disc) * 0.55 * vBright;
    float halo = vHalo * smoothstep(0.1, 0.0, abs(r - 0.76)) * (0.5 + 0.2 * sin(uTime * 1.5));
    float ring = vHi * smoothstep(0.03, 0.0, abs(r - 0.56)) * 0.8;
    vec3 c = vColor * (disc * lit * (0.2 + vBright) + glow) + vec3(1.0, 0.72, 0.4) * halo + vec3(ring);
    gl_FragColor = vec4(c, clamp(max(disc, max(glow, max(halo, ring))), 0.0, 1.0));
  }`;

function Moons({ people, sel, onPick, reduced }: { people: View[]; sel: string | null; onPick: (id: string) => void; reduced: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false }), [uniforms]);
  const geo = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);
  const pos = useMemo(() => ringLayout(people.map((p) => p.affinity)), [people]);
  const attrs = useMemo(() => {
    const n = people.length, col = new Float32Array(n * 3), bright = new Float32Array(n), halo = new Float32Array(n), c = new THREE.Color(), now = Date.now();
    people.forEach((p, i) => { c.set(AFFINITY_COLOR[p.affinity]); col.set([c.r, c.g, c.b], i * 3); bright[i] = recency(p.last, now); halo[i] = p.overdue ? 1 : 0; });
    return { col, bright, halo, hi: new Float32Array(n) };
  }, [people]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    people.forEach((p, i) => { o.position.set(pos[i][0], pos[i][1], 0); o.scale.setScalar(moonSize(p.importance) * 2.2); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [people, pos]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const a = m.geometry.getAttribute("aHi") as THREE.InstancedBufferAttribute | undefined;
    if (!a) return;
    people.forEach((p, i) => { a.array[i] = p.id === sel || i === hover ? 1 : 0; });
    a.needsUpdate = true;
  }, [people, sel, hover]);
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = reduced ? 1 : clock.elapsedTime % 1000;
    if (!reduced && hover === null && group.current) group.current.rotation.z += Math.min(dt, 0.1) * 0.02;
  });
  const label = hover !== null ? people[hover] : undefined;
  const lp = hover !== null ? new THREE.Vector3(pos[hover][0], pos[hover][1], 0).applyMatrix4(group.current?.matrixWorld ?? new THREE.Matrix4()) : null;
  return <>
    <group ref={group}>
      <instancedMesh key={people.length} ref={mesh} args={[geo, mat, people.length]} frustumCulled={false}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.instanceId != null) setHover(e.instanceId); }}
        onPointerOut={() => setHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId != null) onPick(people[e.instanceId].id); }}>
        <instancedBufferAttribute attach="geometry-attributes-aColor" args={[attrs.col, 3]} />
        <instancedBufferAttribute attach="geometry-attributes-aBright" args={[attrs.bright, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aHalo" args={[attrs.halo, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aHi" args={[attrs.hi, 1]} />
      </instancedMesh>
    </group>
    {label && lp && <Html position={lp} style={{ pointerEvents: "none", transform: "translate(14px, -50%)" }} zIndexRange={[12, 0]}>
      <div className="memory-star-label"><b>{label.name}</b><span>{label.relation || label.affinity} · {ago(label.last)}{label.overdue ? " · check in" : ""}</span></div>
    </Html>}
  </>;
}

/** The ring's own canvas (mounted by MemoryWorld instead of the constellation while People is open). */
export function PeopleCanvas({ st, reduced, paused }: { st: PeopleState; reduced: boolean; paused: boolean }) {
  const glr = useGlRecovery();
  if (!st.people?.length) return null; // mounts with its data, so one WarmCompile covers the moon program
  return (
    <Canvas key={glr.key} onCreated={(s) => { glr.onCreated(s); s.camera.lookAt(0, 0, 0); }} frameloop={paused ? "never" : "always"} camera={{ position: [0, -10, 22], fov: 50 }} dpr={[1, 1.5]}
      onPointerMissed={() => st.setSel(null)} aria-hidden="true">
      <WarmCompile world="people" />
      <color attach="background" args={["#020308"]} />
      <Moons people={st.people} sel={st.sel} onPick={st.setSel} reduced={reduced} />
    </Canvas>
  );
}

const BLANK = { name: "", relation: "", affinity: "life" as Affinity, importance: 3, remindDays: 21, notes: "", cares: "", next: "" };

/** List, add form and the person card with timeline and check-in draft. */
export function PeoplePanel({ st }: { st: PeopleState }) {
  const { people, err, sel, setSel, reload } = st;
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState<{ person: View; timeline: Touch[] } | null>(null);
  const [edit, setEdit] = useState(BLANK);
  const [note, setNote] = useState("");
  const loadDetail = useCallback((id: string) => fetch(`${API}?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => {
    if (j.person) { setDetail(j); setEdit({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, j.person[k]])) }); }
  }).catch(() => {}), []);
  useEffect(() => { setDetail(null); setMsg(""); if (sel) void loadDetail(sel); }, [sel, loadDetail]);
  const sorted = useMemo(() => [...(people ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (Date.parse(b.last ?? "0") || 0) - (Date.parse(a.last ?? "0") || 0)), [people]);
  const act = async (label: string, body: object, after?: (j: { person?: View }) => void) => {
    setBusy(label); setMsg("");
    try { const j = await post(body); after?.(j); await reload(); if (sel) await loadDetail(sel); } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };
  const p = detail?.person;
  const field = (k: "relation" | "cares" | "next", label: string, max: number) =>
    <input className="field" aria-label={label} placeholder={label} maxLength={max} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} disabled={!p?.local} />;

  return <div className="space-y-3">
    {err && <p className="error" role="alert">{err}</p>}
    {!people && !err && <p className="muted" role="status">Finding your people…</p>}
    <div className="flex items-center justify-between gap-2">
      <span className="muted text-xs">{people ? `${people.length} people${people.some((x) => x.overdue) ? ` · ${people.filter((x) => x.overdue).length} to check in with` : ""}` : ""}</span>
      <button className="chip" aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add person"}</button>
    </div>
    {adding && <form className="card space-y-1.5" onSubmit={(e) => { e.preventDefault(); void act("add", { action: "add", ...f }, (j) => { setF(BLANK); setAdding(false); if (j.person) setSel(j.person.id); }); }}>
      <input className="field" aria-label="Name" placeholder="Name" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="field" aria-label="Relation" placeholder="Relation (client, friend, collaborator…)" maxLength={60} value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} />
      <div className="flex flex-wrap gap-1.5">
        <select className="chip" aria-label="Planet" value={f.affinity} onChange={(e) => setF({ ...f, affinity: e.target.value as Affinity })}>{AFFINITIES.map((a) => <option key={a}>{a}</option>)}</select>
        <select className="chip" aria-label="Importance" value={f.importance} onChange={(e) => setF({ ...f, importance: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>importance {n}</option>)}</select>
      </div>
      <textarea className="field" aria-label="Notes" placeholder="Your notes" maxLength={2000} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <button className="btn" disabled={!!busy || !f.name.trim()}>Add</button>
    </form>}
    {msg && <p className="error" role="alert">{msg}</p>}

    {p && <div className="card space-y-2" aria-label={`${p.name}`}>
      <div className="flex items-center justify-between gap-2">
        <div><div className="font-medium">{p.name}</div><div className="muted text-xs">{p.relation || "—"} · {p.affinity} · last contact {ago(detail.timeline[0]?.at ?? null)}</div></div>
        <button className="chip" onClick={() => setSel(null)} aria-label="Close card">×</button>
      </div>
      {!p.local && <p className="muted text-xs">From BUSINESS. Keep them as a person to add your own notes, importance and reminders.</p>}
      {field("relation", "Relation", 60)}
      {field("cares", "What they care about (your words)", 500)}
      {field("next", "Next step", 300)}
      <textarea className="field" aria-label="Notes" placeholder="Your notes" maxLength={2000} rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} disabled={!p.local} />
      {p.local && <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <select className="chip" aria-label="Planet" value={edit.affinity} onChange={(e) => setEdit({ ...edit, affinity: e.target.value as Affinity })}>{AFFINITIES.map((a) => <option key={a}>{a}</option>)}</select>
        <select className="chip" aria-label="Importance" value={edit.importance} onChange={(e) => setEdit({ ...edit, importance: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>importance {n}</option>)}</select>
        <label className="muted flex items-center gap-1">remind after <input className="field w-16" type="number" min={1} max={365} value={edit.remindDays} onChange={(e) => setEdit({ ...edit, remindDays: Number(e.target.value) })} /> days</label>
        <button className="btn" disabled={!!busy} onClick={() => void act("save", { action: "update", id: p.id, ...edit })}>Save</button>
      </div>}
      {p.local
        ? <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void act("log", { action: "log", id: p.id, note }, () => setNote("")); }}>
            <input className="field flex-1" aria-label="Log a contact" placeholder="Log a contact: called about the pilot…" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="chip" disabled={!!busy || !note.trim()}>Log</button>
          </form>
        : <button className="btn" disabled={!!busy} onClick={() => void act("keep", { action: "keep", prospectId: p.prospectId }, (j) => { if (j.person) setSel(j.person.id); })}>Keep as a person</button>}
      <div>
        <div className="muted text-[10px] uppercase tracking-widest">Timeline</div>
        {detail.timeline.length ? <ul className="space-y-0.5 text-xs">{detail.timeline.slice(0, 12).map((t, i) =>
          <li key={i} className="flex gap-2"><span className="muted num w-20 shrink-0">{t.at.slice(0, 10)}</span><span className="truncate">{t.what}</span><span className="muted ml-auto">{t.via}</span></li>)}</ul>
          : <p className="muted text-xs">No contact found yet. Log one above.</p>}
      </div>
      {p.local && <div className="space-y-1">
        <button className="btn" disabled={!!busy} onClick={() => void act("checkin", { action: "checkin", id: p.id })}>{busy === "checkin" ? "Drafting…" : p.draft ? "Redraft check-in" : "Draft a check-in"}</button>
        {p.draft && <>
          <textarea className="field" readOnly rows={4} aria-label="Check-in draft" value={p.draft} />
          <p className="muted text-[11px]">A draft only: ORBIT doesn&apos;t send it.{p.prospectId ? " For a business contact, send through BUSINESS's own approve & send." : " Copy it into your own chat."}</p>
          <div className="flex gap-1.5">
            <button className="chip" onClick={() => void navigator.clipboard?.writeText(p.draft).catch(() => {})}>Copy</button>
            {p.prospectId && <button className="chip" onClick={() => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "business" } }))}>Open in BUSINESS</button>}
          </div>
        </>}
      </div>}
      {p.local && <button className="chip text-xs" disabled={!!busy} onClick={() => { if (confirm(`Remove ${p.name} from People? Your notes about them go too.`)) void act("delete", { action: "delete", id: p.id }, () => setSel(null)); }}>Remove</button>}
    </div>}

    {!!sorted.length && <ul className="space-y-0.5" aria-label="People">{sorted.map((x) =>
      <li key={x.id}><button className="chip w-full justify-between text-left" aria-pressed={sel === x.id} onClick={() => setSel(x.id)}>
        <span className="flex min-w-0 items-center gap-1.5"><i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9, flex: "none", background: AFFINITY_COLOR[x.affinity] }} /><span className="truncate">{x.name}</span><span className="muted truncate">{x.relation}</span></span>
        <span className={x.overdue ? "text-amber-300" : "muted"}>{x.overdue ? "check in · " : ""}{ago(x.last)}</span></button></li>)}</ul>}
    {people && !people.length && <p className="muted text-xs">No one yet. Add the people you work with; contacted BUSINESS clients appear here on their own.</p>}
    <p className="muted text-[11px]">Moons glow brighter the more recently you were in touch; size is the importance you set; an amber halo means someone important is due a check-in. People stay on this PC; CORE only sees a name, relation and last contact when you mention them.</p>
  </div>;
}
