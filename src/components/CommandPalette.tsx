"use client";
// "Warp" command palette: Ctrl/⌘+K (also Ctrl/⌘+P, Ctrl/⌘+Shift+K, the HUD ⌕ button or PALETTE_EVENT) opens it.
// Places and quick actions come from palette-commands.ts; search covers memories (server search), goals, approvals,
// prospects, people and VAULT file names, then "Ask CORE". Ranking: lib/palette-pure.ts. Nothing here approves, sends or
// spends: a goal, approval or prospect only opens where the owner decides it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { validateNav } from "@/lib/nav-pure";
import { rank, pushRecent, parseRecent, prospectRows, rowsOf, PALETTE_EVENT, OPEN_MEMORY_EVENT, type Recent } from "@/lib/palette-pure";
import { bridgeApprovals } from "@/lib/mission-pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";
import { notify } from "@/lib/notify-pure";
import { createClient } from "@/lib/supabase/client";
import { VOICE_ASK } from "./voice/bus";
import { AlienScript } from "./AlienScript";
import { COMMANDS, nav, type Command } from "./palette-commands";

export { PALETTE_EVENT, OPEN_MEMORY_EVENT };

type Item = Recent & { keywords?: string; run: () => void };
type Group = { name: string; items: Item[] };
type Pool = { goals: Recent[]; approvals: Recent[]; prospects: Recent[]; people: Recent[] };

const RECENT_KEY = "orbit.palette.recent";
const STATIC = new Map<string, Command>(COMMANDS.map((c) => [c.id, c]));
const MAX = 5; // rows per search group

/** Opens a search result by its id prefix, so a recent result can be reopened later from its id alone. */
function openById(id: string) {
  const at = id.indexOf(":"), kind = id.slice(0, at), key = id.slice(at + 1);
  const cite = (k: string) => dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: { id: `x:${key}`, kind: k, title: "" } }));
  if (STATIC.has(id)) STATIC.get(id)!.run();
  else if (kind === "mem") { nav({ panel: "memory" }); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: key } })); }
  else if (kind === "goal") cite("week:goal");
  else if (kind === "task") cite("week:task"); // a task waiting for approval: opens it in OPERATIONS
  else if (kind === "prop") nav({ panel: "agents" }); // proposals are decided in AGENTS
  else if (kind === "pros" || kind === "person") nav({ panel: "business" });
  else if (kind === "file") nav({ panel: "vault" });
}
const REOPENABLE = /^(go|act|mem|goal|task|prop|pros|person|file):/;

function loadRecent(): Recent[] {
  try { return parseRecent(localStorage.getItem(RECENT_KEY), (id) => STATIC.get(id)?.label); } catch { return []; }
}
const get = (url: string, signal: AbortSignal) => fetch(url, { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Lists searched on this device: loaded once per opening (read-only GETs; goals straight from the table, since
 *  GET /api/goals also advances live goals). */
async function loadPool(signal: AbortSignal): Promise<Pool> {
  const sb = createClient();
  const [biz, tasks, proposals, goals] = await Promise.all([
    get("/api/business", signal), get("/api/tasks", signal), get("/api/proposals", signal),
    Promise.resolve(sb.from("goals").select("id, title:doc->>title").order("updated_at", { ascending: false }).limit(100)).then((r) => r.data ?? []).catch(() => []),
  ]);
  const approvals = bridgeApprovals(tasks, proposals).map((w): Recent => ({ id: `${w.where === "operations" ? "task" : "prop"}:${w.id}`, label: w.title, hint: w.where === "operations" ? "Task waiting · OPERATIONS" : "Proposal · AGENTS" }));
  const { prospects, people } = prospectRows(biz);
  return {
    goals: rowsOf(goals, 100).map((g) => ({ id: `goal:${g.id}`, label: g.title, hint: "GOAL" })),
    approvals,
    prospects: prospects.map((p) => ({ ...p, id: `pros:${p.id}` })),
    people: people.map((p) => ({ ...p, id: `person:${p.id}` })),
  };
}

export function CommandPalette() {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [mems, setMems] = useState<{ id: string; title: string }[]>([]);
  const [files, setFiles] = useState<{ id: string; title: string }[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);

  useEffect(() => {
    const open = () => { const d = ref.current; if (!d || d.open) return; setRecent(loadRecent()); d.showModal(); setIsOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k" || k === "p") { e.preventDefault(); if (ref.current?.open) ref.current.close(); else open(); }
    };
    addEventListener("keydown", onKey);
    addEventListener(PALETTE_EVENT, open);
    return () => { removeEventListener("keydown", onKey); removeEventListener(PALETTE_EVENT, open); };
  }, []);

  const term = q.trim();
  const wantPool = isOpen && !!term && !pool;
  useEffect(() => {
    if (!wantPool) return;
    const ac = new AbortController();
    loadPool(ac.signal).then((p) => { if (!ac.signal.aborted) setPool(p); });
    return () => ac.abort();
  }, [wantPool]);

  // Debounced server search; stale responses are aborted.
  useEffect(() => {
    setMems([]); setFiles([]);
    if (!term) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      const enc = encodeURIComponent(term.slice(0, 200));
      get(`/api/memories?q=${enc}`, ac.signal).then((j) => { if (!ac.signal.aborted) setMems(rowsOf(j)); });
      // File names only (the listing is cheap); "search inside" stays in VAULT, where building the text index is expected.
      get("/api/vault", ac.signal).then((j) => {
        if (!ac.signal.aborted) setFiles(rank(term, rowsOf({ files: j?.files ?? [] }, 500).map((f) => ({ ...f, label: f.title }))).slice(0, MAX));
      });
    }, 200);
    return () => { clearTimeout(t); ac.abort(); };
  }, [term]);

  const groups = useMemo<Group[]>(() => {
    const ids = recent.map((r) => r.id);
    const asItem = (r: Recent & { keywords?: string }): Item => ({ ...r, run: () => openById(r.id) });
    const statics = (g: Command["group"]) => COMMANDS.filter((c) => c.group === g).map(asItem);
    if (!term) {
      return [{ name: "Recent", items: recent.filter((r) => REOPENABLE.test(r.id)).map(asItem) },
        { name: "Actions", items: statics("Actions").slice(0, 6) }, { name: "Go to", items: statics("Go to").filter((i) => !ids.includes(i.id)) }];
    }
    const found = (rows: Recent[] | undefined) => rank(term, rows ?? [], ids).slice(0, MAX).map(asItem);
    const news = validateNav({ search: term });
    const save: Item = { id: "dyn:save", label: `Save “${term}” as a memory`, hint: "MEMORY · note", run: () => {
      fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "note", title: term.slice(0, 300), content: term }) })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Save failed (${r.status})`); notify({ kind: "core", title: "Memory saved", body: term.slice(0, 120), nav: { panel: "memory" } }); })
        .catch((e) => notify({ kind: "system", title: "Couldn't save the memory", body: e instanceof Error ? e.message : String(e) }));
    } };
    return [
      { name: "Go to", items: rank(term, statics("Go to"), ids) },
      { name: "Actions", items: [...rank(term, statics("Actions"), ids), save, ...(news ? [{ id: "dyn:news", label: `Open news for “${term}”`, hint: "INTELLIGENCE", run: () => nav(news) }] : [])] },
      { name: "Approvals", items: found(pool?.approvals) },
      { name: "Memories", items: mems.slice(0, MAX).map((m) => asItem({ id: `mem:${m.id}`, label: m.title, hint: "MEMORY" })) },
      { name: "Goals", items: found(pool?.goals) },
      { name: "People", items: found(pool?.people) },
      { name: "Prospects", items: found(pool?.prospects) },
      { name: "Files", items: files.map((f) => asItem({ id: `file:${f.id}`, label: f.title, hint: "VAULT" })) },
      { name: "CORE", items: [{ id: "dyn:ask", label: `Ask CORE: ${term}`, run: () => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: term } })) }] },
    ];
  }, [term, recent, mems, files, pool]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const cur = Math.min(active, flat.length - 1);
  useEffect(() => setActive(0), [term]);
  useEffect(() => { document.getElementById(`pal-${cur}`)?.scrollIntoView({ block: "nearest" }); }, [cur]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    ref.current?.close();
    if (REOPENABLE.test(it.id)) {
      const next = pushRecent(loadRecent(), { id: it.id, label: it.label, ...(it.hint ? { hint: it.hint } : {}) });
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode: no recents */ }
    }
    it.run();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const n = flat.length;
    if (!n) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((cur + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((cur - 1 + n) % n); }
    else if (e.key === "PageDown") { e.preventDefault(); setActive(Math.min(cur + 5, n - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setActive(Math.max(cur - 5, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(flat[cur]); }
  };

  let n = -1;
  return (
    <dialog ref={ref} aria-label="Warp: command palette" aria-describedby="pal-help"
      className="glass warp mx-auto mt-[12vh] w-[calc(100vw-2rem)] max-w-xl p-0 text-[var(--ink)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onClose={() => { setQ(""); setActive(0); setIsOpen(false); setPool(null); }}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="p-3">
        <div className="warp-head"><span className="h3">Warp</span><AlienScript text="WARP DRIVE" className="warp-script" /></div>
        <input className="field w-full" autoFocus placeholder="Jump, search, act… or ask CORE"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
          role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Warp to"
          aria-activedescendant={cur >= 0 ? `pal-${cur}` : undefined} spellCheck={false} autoComplete="off" />
        <div id="pal-list" role="listbox" aria-label="Results" className="mt-2 max-h-[55vh] overflow-y-auto">
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.name} role="group" aria-labelledby={`pal-g-${g.name}`} className="mb-1">
              <div id={`pal-g-${g.name}`} className="h3 px-2 pb-1 pt-2">{g.name}</div>
              {g.items.map((it) => {
                const i = ++n;
                return (
                  <div key={it.id} id={`pal-${i}`} role="option" aria-selected={i === cur}
                    className={`warp-opt flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm${i === cur ? " is-on" : ""}`}
                    onMouseMove={() => { if (i !== cur) setActive(i); }}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                    onClick={() => choose(it)}>
                    <span className="truncate">{it.label}</span>
                    {it.hint && <span className="muted shrink-0 truncate text-xs max-w-[50%]">{it.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">{isOpen && term ? `${flat.length} results` : ""}</p>
        <div id="pal-help" className="muted mt-2 flex gap-3 border-t border-white/10 px-1 pt-2 text-xs">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </dialog>
  );
}
