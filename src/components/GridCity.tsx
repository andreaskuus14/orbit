"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { useT } from "./i18n";
import { OrbitControls } from "@react-three/drei";
import { useGlRecovery } from "./useGlRecovery";
import { GRID_ERRORS_KEY, GRID_SCRIPTS_KEY, GRID_SNIPPET, attachErrors, layoutGrid, parseScriptList, type Building, type GridLayout } from "@/lib/grid-pure";

// DevWorld → Tron Grid: every script is a building (height ~ lines), districts by service/folder, red = console errors.
// One instanced mesh for all buildings, so a few thousand scripts stay one draw call. frameloop "demand": no idle GPU work.
const CYAN = "#22d3ee", RED = "#ff3b5c";
const load = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* no storage: kept until reload */ } };

function City({ g, picked, onHover, onPick }: { g: GridLayout; picked: number | null; onHover: (i: number | null, x: number, y: number) => void; onPick: (i: number) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D(), c = new THREE.Color();
    g.buildings.forEach((b, k) => {
      o.position.set(b.x, b.h / 2, b.z); o.scale.set(0.7, b.h, 0.7); o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      m.setColorAt(k, c.set(b.script.errors.length ? RED : CYAN).multiplyScalar(k === picked ? 1.8 : 1));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    invalidate(); // frameloop "demand": matrix/colour writes don't schedule a frame on their own
  }, [g, picked, invalidate]);
  return (
    <>
      <gridHelper args={[g.size + 6, Math.round(g.size + 6), "#0e7490", "#083344"]} position-y={0.001} />
      {g.districts.map((d) => (
        <mesh key={d.name} rotation-x={-Math.PI / 2} position={[d.x + d.w / 2, 0.01, d.z + d.d / 2]}>
          <planeGeometry args={[d.w + 0.3, d.d + 0.3]} />
          <meshBasicMaterial color="#0891b2" transparent opacity={0.12} depthWrite={false} />
        </mesh>
      ))}
      {/* key: instance count is fixed at creation */}
      <instancedMesh key={g.buildings.length} ref={ref} args={[undefined, undefined, g.buildings.length]}
        onPointerMove={(e) => { e.stopPropagation(); onHover(e.instanceId ?? null, e.nativeEvent.offsetX, e.nativeEvent.offsetY); }}
        onPointerOut={() => onHover(null, 0, 0)}
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 5 && e.instanceId !== undefined) onPick(e.instanceId); }}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function Detail({ b }: { b: Building }) {
  const { t } = useT();
  const s = b.script;
  return (
    <div className="card space-y-1" style={{ boxShadow: `inset 3px 0 0 ${s.errors.length ? RED : CYAN}` }} aria-live="polite">
      <p className="text-sm font-semibold">{s.name}</p>
      <p className="muted break-all text-xs">{s.path} · {t("grid.lines", { n: s.lines })}</p>
      {s.errors.length ? s.errors.map((e, i) => <code key={i} className="block whitespace-pre-wrap break-all text-[11px]" style={{ color: RED }}>{e}</code>)
        : <p className="muted text-xs">{t("grid.noErrors")}</p>}
    </div>
  );
}

export default function GridCity() {
  const { t } = useT();
  const glr = useGlRecovery();
  const [scripts, setScripts] = useState("");
  const [errors, setErrors] = useState("");
  const [hover, setHover] = useState<{ i: number | null; x: number; y: number }>({ i: null, x: 0, y: 0 });
  const [picked, setPicked] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setScripts(load(GRID_SCRIPTS_KEY)); setErrors(load(GRID_ERRORS_KEY)); }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const g = useMemo(() => layoutGrid(attachErrors(parseScriptList(scripts), errors)), [scripts, errors]);
  useEffect(() => setPicked(null), [g]);
  const bad = g.buildings.filter((b) => b.script.errors.length).length;
  const tip = hover.i !== null ? g.buildings[hover.i] : null;
  const sel = picked !== null ? g.buildings[picked] : null;
  const far = Math.max(8, g.size * 1.1);

  const inputs = (
    <div className="grid gap-2">
      <ol className="muted list-decimal pl-4 text-xs">
        <li>{t("grid.step1")}</li>
        <li>{t("grid.step2")}</li>
      </ol>
      <code className="block select-all whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px]">{GRID_SNIPPET}</code>
      <label className="text-xs">3. {t("grid.step3")}
        <textarea className="field mt-1 w-full font-mono" rows={4} placeholder={t("grid.scriptsPh")} value={scripts}
          onChange={(e) => { setScripts(e.target.value); save(GRID_SCRIPTS_KEY, e.target.value); }} />
      </label>
      <label className="text-xs">{t("grid.errors")}
        <textarea className="field mt-1 w-full font-mono" rows={3} placeholder={t("grid.errorsPh")} value={errors}
          onChange={(e) => { setErrors(e.target.value); save(GRID_ERRORS_KEY, e.target.value); }} />
      </label>
    </div>
  );

  if (!g.buildings.length) return (
    <section className="glass rounded-xl p-3 text-sm" aria-label={t("grid.title")}>
      <h3 className="brand mb-2 text-sm" style={{ color: CYAN }}>{t("grid.title")}</h3>
      <p className="mb-2 text-xs"><b>{t("grid.empty1")}</b> {t("grid.empty2")}</p>
      {inputs}
    </section>
  );

  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" aria-label={t("grid.title")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="brand text-sm" style={{ color: CYAN }}>{t("grid.title")}</h3>
        <button className="chip" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? t("grid.done") : t("grid.update")}</button>
      </div>
      <p className="muted text-xs">{t("grid.stats", { s: g.buildings.length, d: g.districts.length })} · <span style={{ color: bad ? RED : undefined }}>{t("grid.withErrors", { n: bad })}</span></p>
      {editing && inputs}
      <div className="relative h-72 overflow-hidden rounded-lg" role="img" aria-label={t("grid.cityAria", { s: g.buildings.length, d: g.districts.length, n: bad })}>
        <Canvas key={glr.key} onCreated={glr.onCreated} frameloop="demand" camera={{ position: [far * 0.7, far * 0.8, far * 0.7], fov: 45 }} dpr={[1, 2]}>
          <color attach="background" args={["#010409"]} />
          <City g={g} picked={picked} onPick={setPicked}
            onHover={(i, x, y) => { setHover({ i, x, y }); document.body.style.cursor = i !== null ? "pointer" : ""; }} />
          <OrbitControls makeDefault enablePan maxPolarAngle={Math.PI / 2.1} minDistance={2} maxDistance={far * 3} />
        </Canvas>
        {tip && (
          <span aria-hidden className="globe-tip pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${hover.x + 12}px, ${hover.y + 10}px)` }}>
            {tip.script.name} · {t("grid.lines", { n: tip.script.lines })}{tip.script.errors.length ? ` · ${t("grid.errCount", { n: tip.script.errors.length })}` : ""}
          </span>
        )}
      </div>
      {sel && <Detail b={sel} />}
      <details>
        <summary className="cursor-pointer text-xs">{t("grid.list")}</summary>
        {g.districts.map((d) => (
          <div key={d.name} className="mt-2">
            <div className="hud-title">{d.name}</div>
            <ul className="space-y-1">
              {g.buildings.map((b, i) => b.script.district !== d.name ? null : (
                <li key={b.script.path}>
                  <button className="hud-row" style={{ ["--accent" as string]: b.script.errors.length ? RED : CYAN }} aria-pressed={picked === i} onClick={() => setPicked(i)}
                    aria-label={`${b.script.path}, ${t("grid.lines", { n: b.script.lines })}, ${t("grid.errCount", { n: b.script.errors.length })}`}>
                    <span className="truncate">{b.script.name}</span><span className="num">{b.script.lines}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}
