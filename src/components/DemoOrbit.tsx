"use client";
// Public demo shell (/demo): the real Galaxy and four real worlds, fed only with fixture responses through the demo fetch guard.
// No Supabase, no server data, no model calls; tests/demo-leak.test.ts walks this file's import graph.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PanelId } from "@/lib/planets";
import { coreReply, DEMO_NOTE, DEMO_PROMPTS, DEMO_WORLDS, installDemoGuard, type DemoData, type DemoWorld } from "@/lib/demo-shell-pure";
import { GalaxyLoader } from "./GalaxyLoader";
import { WorldEmblem } from "./WorldEmblem";

const Loading = () => <div className="world-loading" role="status"><span className="world-loading-ring" aria-hidden="true" /><p>Opening world…</p></div>;
const Galaxy = dynamic(() => import("./Galaxy"), { ssr: false, loading: () => <GalaxyLoader /> });
const NewsGlobe = dynamic(() => import("./NewsGlobe"), { ssr: false, loading: Loading });
const StudioWorld = dynamic(() => import("./StudioWorld"), { ssr: false, loading: Loading });
const ArchWorld = dynamic(() => import("./ArchWorld"), { ssr: false, loading: Loading });
const MemoryWorld = dynamic(() => import("./MemoryWorld"), { ssr: false, loading: Loading });

const LABEL: Record<DemoWorld, string> = { studio: "STUDIO", intelligence: "INTELLIGENCE", memory: "MEMORY", arch: "ARCH" };
const isWorld = (id: PanelId): id is DemoWorld => (DEMO_WORLDS as readonly string[]).includes(id);
const noop = () => {};

export default function DemoOrbit({ data, memoryCount }: { data: DemoData; memoryCount: number }) {
  useState(() => { if (typeof window !== "undefined") installDemoGuard(window, data); }); // before any child effect can fetch
  const pulses = useRef<Record<string, number>>({});
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [core, setCore] = useState(false);
  const [hint, setHint] = useState("");
  const [reduced, setReduced] = useState(false);
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on(); m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (!world) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setWorld(null); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [world]);

  const select = (id: PanelId) => {
    if (id === "core") { setCore(true); return; }
    if (isWorld(id)) { setWorld(id); setCore(false); setHint(""); return; }
    setHint("That world stays private. The tour covers STUDIO, INTELLIGENCE, MEMORY and ARCH.");
  };
  const ask = (q: string) => { if (q.trim()) setChat((c) => [...c.slice(-5), { q: q.trim(), a: coreReply(q) }]); setText(""); };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(text); };
  const close = () => setWorld(null);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#02040b]">
      <div className="absolute inset-0">
        <Galaxy selected={world} onSelect={select} memoryCount={memoryCount} pulses={pulses} busy={false} warning={false} pulseBusy={false}
          pulseFailed={false} agentsWorking={0} automationFailing={false} reduced={reduced} panelOpen={core} quality="auto" paused={!!world} />
      </div>
      {world === "intelligence" && <NewsGlobe reduced={reduced} quality="auto" onClose={close} />}
      {world === "studio" && <StudioWorld reduced={reduced} quality="auto" onClose={close} />}
      {world === "memory" && <MemoryWorld reduced={reduced} quality="auto" onClose={close} focusId={null} onChanged={noop} />}
      {world === "arch" && <ArchWorld reduced={reduced} quality="auto" onClose={close} />}

      <p className="glass muted absolute left-1/2 top-3 z-[40] -translate-x-1/2 rounded-full px-4 py-1.5 text-center text-xs max-sm:top-auto max-sm:bottom-[4.1rem] max-sm:whitespace-nowrap max-sm:py-1 max-sm:text-[10px]" role="note">{DEMO_NOTE}</p>

      {core && !world && (
        <section className="glass hud-panel absolute bottom-24 right-3 z-[30] flex max-h-[60dvh] w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto p-3 text-sm" aria-label="CORE (scripted demo)">
          <div className="flex items-center justify-between"><h2 className="brand flex items-center gap-2 text-base"><WorldEmblem id="core" size={28} />CORE <span className="muted text-xs font-normal">scripted demo</span></h2>
            <button className="chip" onClick={() => setCore(false)}>Close</button></div>
          <ul className="space-y-2" aria-live="polite">{chat.map((m, i) => <li key={i}><p className="font-medium">{m.q}</p><p className="muted">{m.a}</p></li>)}</ul>
          <div className="flex flex-wrap gap-1.5">{DEMO_PROMPTS.map((p) => <button key={p} className="chip" onClick={() => ask(p)}>{p}</button>)}</div>
          <form onSubmit={submit} className="flex gap-2">
            <input className="field flex-1" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Ask CORE" aria-label="Ask CORE" />
            <button className="chip" type="submit">Ask</button>
          </form>
        </section>
      )}

      <nav className="glass absolute bottom-3 left-1/2 z-[40] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-2 [scrollbar-width:none]" aria-label="Demo tour">
        {world ? <button className="chip" onClick={close}>← Galaxy</button>
          : <button className="chip" aria-pressed={core} onClick={() => setCore((c) => !c)}><WorldEmblem id="core" size={20} />CORE</button>}
        {DEMO_WORLDS.map((w) => <button key={w} className="chip" aria-pressed={world === w} onClick={() => select(w)}><WorldEmblem id={w} size={20} />{LABEL[w]}</button>)}
      </nav>
      {hint && !world && <p className="glass absolute bottom-16 left-1/2 z-[40] -translate-x-1/2 rounded-xl px-3 py-1.5 text-xs max-sm:bottom-24" role="status">{hint}</p>}
    </main>
  );
}
