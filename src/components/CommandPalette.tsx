"use client";
// Universal search: Ctrl/⌘+P or Ctrl/⌘+Shift+K (or PALETTE_EVENT) opens it. Places, actions, memories, VAULT files, then "Ask CORE".
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { PLANETS } from "@/lib/planets";
import { NAV_EVENT, validateNav, type NavTarget } from "@/lib/nav-pure";
import { rank, pushRecent, rowsOf, PALETTE_EVENT, OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { VOICE_ASK } from "./voice/bus";
import { SHORTCUTS_EVENT } from "./ShortcutsOverlay";

export { PALETTE_EVENT, OPEN_MEMORY_EVENT };

type Item = { id: string; label: string; hint?: string; keywords?: string; run: () => void };
type Group = { name: string; items: Item[] };

const RECENT_KEY = "orbit.palette.recent";
const nav = (t: NavTarget) => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t }));

const GOTO: Item[] = [
  { id: "go:core", label: "CORE", hint: "AI chat", keywords: "chat ai", run: () => nav({ panel: "core" }) },
  ...PLANETS.map((p): Item => ({ id: `go:${p.id}`, label: p.name, hint: p.blurb, keywords: p.id, run: () => nav({ panel: p.id }) })),
  { id: "go:home", label: "Galaxy home", hint: "Back to the galaxy", keywords: "home overview", run: () => nav({ panel: null }) },
  { id: "go:profile", label: "Profile", run: () => nav({ panel: "profile" }) },
];
const ACTIONS: Item[] = [
  { id: "act:doctor", label: "Check ORBIT health", hint: "Run the ORBIT doctor", keywords: "doctor diagnostics", run: () => nav({ panel: null, doctor: true }) },
  { id: "act:keys", label: "Keyboard shortcuts", keywords: "keys help", run: () => dispatchEvent(new Event(SHORTCUTS_EVENT)) },
  { id: "act:morning", label: "Good morning briefing", keywords: "brief daily", run: () => nav({ panel: null, morning: true }) },
  { id: "act:beliefs", label: "What ORBIT believes about me", keywords: "beliefs memory", run: () => nav({ panel: "memory", beliefs: true }) },
  { id: "act:stats", label: "STUDIO stats", hint: "Channel analytics", keywords: "youtube", run: () => nav({ panel: "studio", view: "stats" }) },
  { id: "act:clips", label: "STUDIO clips", hint: "Clip factory", keywords: "shorts youtube", run: () => nav({ panel: "studio", view: "clips" }) },
  { id: "act:review", label: "STUDIO review queue", hint: "Review new clips", keywords: "youtube", run: () => nav({ panel: "studio", view: "review" }) },
  { id: "act:focus", label: "Start focus timer", hint: "LIFE", keywords: "pomodoro focus mode", run: () => nav({ panel: "life", life: "focus", start: true }) },
  { id: "act:journal", label: "Open journal", hint: "LIFE", keywords: "diary write", run: () => nav({ panel: "life", life: "journal" }) },
  { id: "act:reminder", label: "New reminder", hint: "LIFE", keywords: "remind me add", run: () => nav({ panel: "life", life: "reminders" }) },
];
const STATIC = new Map([...GOTO, ...ACTIONS].map((i) => [i.id, i]));

function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

/** Fetch up to 6 {id,title} rows; any failure (404/401/network) = no section. */
async function fetchRows(url: string, signal: AbortSignal) {
  try { const r = await fetch(url, { signal }); return r.ok ? rowsOf(await r.json()) : []; } catch { return []; }
}

export function CommandPalette() {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [mems, setMems] = useState<{ id: string; title: string }[]>([]);
  const [files, setFiles] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const open = () => { const d = ref.current; if (!d || d.open) return; setRecent(loadRecent()); d.showModal(); };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "p" || (k === "k" && e.shiftKey)) { e.preventDefault(); if (ref.current?.open) ref.current.close(); else open(); }
    };
    addEventListener("keydown", onKey);
    addEventListener(PALETTE_EVENT, open);
    return () => { removeEventListener("keydown", onKey); removeEventListener(PALETTE_EVENT, open); };
  }, []);

  // Debounced remote search; stale responses are aborted.
  const term = q.trim();
  useEffect(() => {
    setMems([]); setFiles([]);
    if (!term) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      const enc = encodeURIComponent(term.slice(0, 200));
      fetchRows(`/api/memories?q=${enc}`, ac.signal).then((r) => { if (!ac.signal.aborted) setMems(r); });
      // File names only (the listing is cheap); "search inside" stays in VAULT, where building the text index is expected.
      const low = term.toLowerCase();
      fetch("/api/vault", { signal: ac.signal }).then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!ac.signal.aborted) setFiles(rowsOf({ files: (j?.files ?? []).filter((f: { name?: unknown }) => typeof f.name === "string" && f.name.toLowerCase().includes(low)) }));
      }).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); ac.abort(); };
  }, [term]);

  const groups = useMemo<Group[]>(() => {
    if (!term) {
      const rec = recent.map((id) => STATIC.get(id)).filter((i): i is Item => !!i);
      return [{ name: "Recent", items: rec }, { name: "Go to", items: GOTO.filter((i) => !rec.includes(i)) }];
    }
    const news = validateNav({ search: term });
    return [
      { name: "Go to", items: rank(term, GOTO) },
      { name: "Actions", items: [...rank(term, ACTIONS), ...(news ? [{ id: "dyn:news", label: `Open news for “${term}”`, hint: "INTELLIGENCE", run: () => nav(news) }] : [])] },
      { name: "Memories", items: mems.map((m) => ({ id: `mem:${m.id}`, label: m.title, hint: "MEMORY", run: () => { nav({ panel: "memory" }); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: m.id } })); } })) },
      { name: "Files", items: files.map((f) => ({ id: `file:${f.id}`, label: f.title, hint: "VAULT", run: () => nav({ panel: "vault" }) })) },
      { name: "CORE", items: [{ id: "dyn:ask", label: `Ask CORE: ${term}`, run: () => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: term } })) }] },
    ];
  }, [term, recent, mems, files]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const cur = Math.min(active, flat.length - 1);
  useEffect(() => setActive(0), [term]);
  useEffect(() => { document.getElementById(`pal-${cur}`)?.scrollIntoView({ block: "nearest" }); }, [cur]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    ref.current?.close();
    if (STATIC.has(it.id)) {
      const next = pushRecent(loadRecent(), it.id);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode: no recents */ }
    }
    it.run();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((cur + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((cur - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(flat[cur]); }
  };

  let n = -1;
  return (
    <dialog ref={ref} aria-label="Command palette"
      className="glass mx-auto mt-[12vh] w-[calc(100vw-2rem)] max-w-xl p-0 text-[var(--ink)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onClose={() => { setQ(""); setActive(0); }}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="p-3">
        <input className="field w-full" autoFocus placeholder="Search places, actions, memories, files… or ask CORE"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
          role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list"
          aria-activedescendant={cur >= 0 ? `pal-${cur}` : undefined} spellCheck={false} autoComplete="off" />
        <div id="pal-list" role="listbox" aria-label="Results" className="mt-2 max-h-[55vh] overflow-y-auto">
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-1">
              <div className="h3 px-2 pb-1 pt-2" aria-hidden="true">{g.name}</div>
              {g.items.map((it) => {
                const i = ++n;
                return (
                  <div key={it.id} id={`pal-${i}`} role="option" aria-selected={i === cur}
                    className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm ${i === cur ? "bg-white/10" : ""}`}
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
        <div className="muted mt-2 flex gap-3 border-t border-white/10 px-1 pt-2 text-xs">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </dialog>
  );
}
