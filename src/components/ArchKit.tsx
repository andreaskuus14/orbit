"use client";
// ARCH building kit panel: open the kit house or an empty scene, browse the part hierarchy (select a part, hide a group),
// reuse a kit group in the current scene, and swap the selected window or door for another type.
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";
import { isOpening, type Group, type Part, type Scene } from "@/lib/arch-pure";
import { insertGroup, kitGroups, kitHouse, OPENING_TYPES, partTree, replaceOpening } from "@/lib/arch-kit-pure";

const GROUPS = kitGroups();

export function ArchKit({ scene, sel, onSelect, hidden, onHidden, onScene, newId }: {
  scene: Scene; sel: string | null; onSelect: (id: string) => void; hidden: Set<Group>; onHidden: (h: Set<Group>) => void;
  onScene: (s: Scene) => void; newId: () => string;
}) {
  const { t: tr } = useT();
  const part: Part | undefined = scene.parts.find((p) => p.id === sel);
  const toggle = (g: Group) => { const h = new Set(hidden); if (h.has(g)) h.delete(g); else h.add(g); onHidden(h); };
  return (
    <div className="card space-y-1.5 text-xs" aria-label={tr("arch.kit")}>
      <div className="muted text-[10px] uppercase tracking-widest">{tr("arch.kit")}</div>
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" onClick={() => onScene(kitHouse())}>🏠 {tr("arch.kitHouse")}</button>
        <button className="chip" onClick={() => onScene({ ...scene, parts: [] })}>{tr("arch.kitBlank")}</button>
      </div>
      {part && isOpening(part.kind) && <div className="flex flex-wrap items-center gap-1.5" aria-label={tr("arch.kitReplace")}>
        <span>{tr("arch.kitReplace")}:</span>
        {OPENING_TYPES.filter((o) => o.kind === part.kind).map((o) => <button key={o.key} className="chip" aria-pressed={part.name.endsWith(`(${o.key})`)}
          onClick={() => onScene(replaceOpening(scene, part.id, o.key))} title={o.name}>{o.key}</button>)}
      </div>}
      <div className="flex flex-wrap items-center gap-1.5" aria-label={tr("arch.kitReuse")}>
        <span>{tr("arch.kitReuse")}:</span>
        {GROUPS.map((g) => <button key={g.name} className="chip" onClick={() => onScene(insertGroup(scene, g.parts, { x: 0, z: 0 }, newId))}>+ {g.name}</button>)}
      </div>
      <details open><summary className="cursor-pointer">{tr("arch.kitParts")} ({scene.parts.length})</summary>
        <ul className="space-y-1 pl-1" aria-label={tr("arch.kitParts")}>
          {partTree(scene.parts).map(({ group, subs }) => <li key={group}>
            <label className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={!hidden.has(group)} onChange={() => toggle(group)} />{tr(`arch.kitG.${group}` as Key)}</label>
            <ul className="pl-4">{subs.map((s) => <li key={s.name}>
              <span className="muted">{s.name}</span>
              <span className="flex flex-wrap gap-1">{s.parts.map((p) => <button key={p.id} className="chip" aria-pressed={p.id === sel} disabled={hidden.has(group)}
                onClick={() => onSelect(p.id)}>{p.name.includes(" · ") ? p.name.split(" · ").slice(1).join(" · ") : p.name}</button>)}</span>
            </li>)}</ul>
          </li>)}
        </ul>
      </details>
      <p className="muted text-[11px]">{tr("arch.kitHint")}</p>
    </div>
  );
}
