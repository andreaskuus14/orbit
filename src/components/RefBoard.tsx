"use client";
import { useEffect, useRef, useState } from "react";
import RobloxBuild from "./RobloxBuild";
import { KIND_LABEL, allowedImage, groupBoard, studioPrompt, urls, EMPTY_STYLE, MAX_STYLE, MAX_SUMMARY, type BoardItem, type Pick, type RefItem, type RefKind, type Style } from "@/lib/refs-pure";

// GAME DEV → 🎨 References: type a word, see Creator Store models + CC images + Reddit inspiration, let AI pick the best
// for Roblox, brainstorm variations, save to a moodboard, and hand one to RobloxBuild. Data: /api/refs.

const PINK = "#f472b6";
type Section = { kind: RefKind; items: RefItem[]; error?: string };
type BuildItem = { kind: "asset"; assetId: number; name: string } | { kind: "generate"; prompt: string };

async function api<T>(init?: RequestInit, q?: string, styled = false): Promise<T> {
  const res = await fetch(q === undefined ? "/api/refs" : `/api/refs?q=${encodeURIComponent(q)}${styled ? "&style=1" : ""}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const post = <T,>(body: object) => api<T>({ method: "POST", body: JSON.stringify(body) });
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export default function RefBoard() {
  const [input, setInput] = useState("");
  const [base, setBase] = useState(""); // the word he typed; idea chips search variations of it
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<Section[] | null>(null);
  const [busy, setBusy] = useState<"" | "search" | "pick" | "ideas">("");
  const [err, setErr] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [build, setBuild] = useState<BuildItem | null>(null);
  const [style, setStyle] = useState<Style>(EMPTY_STYLE);
  const [summary, setSummary] = useState(""); // textarea draft, saved on blur
  const [matchStyle, setMatchStyle] = useState(true); // only applies once a style has keywords
  const [styleBusy, setStyleBusy] = useState(false);
  const seq = useRef(0);
  const buildRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api<{ board: BoardItem[]; style: Style }>().then((r) => { setBoard(r.board); setStyle(r.style); setSummary(r.style.summary); }).catch((e) => setErr(msg(e))); }, []);
  const styled = matchStyle && style.keywords.length > 0;
  useEffect(() => { if (build) buildRef.current?.scrollIntoView({ block: "nearest" }); }, [build]);

  async function search(q: string, typed: boolean, useStyle = styled) {
    const word = q.replace(/\s+/g, " ").trim();
    if (!word) return;
    const n = ++seq.current;
    setBusy("search"); setErr(""); setPicks([]); setQuery(word); setInput(word);
    if (typed) { setBase(word); setIdeas([]); }
    try {
      const r = await api<{ sections: Section[] }>(undefined, word, useStyle);
      if (n === seq.current) setSections(r.sections);
    } catch (e) { if (n === seq.current) { setErr(msg(e)); setSections(null); } }
    finally { if (n === seq.current) setBusy(""); }
  }

  async function aiPick() {
    const n = seq.current;
    setBusy("pick"); setErr("");
    try { const r = await post<{ picks: Pick[] }>({ action: "pick", q: query, styled }); if (n === seq.current) { setPicks(r.picks); if (!r.picks.length) setErr("No picks came back — try again."); } }
    catch (e) { if (n === seq.current) setErr(msg(e)); } finally { if (n === seq.current) setBusy(""); }
  }
  async function brainstorm() {
    const n = seq.current;
    setBusy("ideas"); setErr("");
    try { const r = await post<{ ideas: string[] }>({ action: "ideas", q: base || query }); if (n === seq.current) setIdeas(r.ideas); }
    catch (e) { if (n === seq.current) setErr(msg(e)); } finally { if (n === seq.current) setBusy(""); }
  }
  async function save(item: RefItem) {
    try { setBoard((await post<{ board: BoardItem[] }>({ action: "save", item, word: query })).board); } catch (e) { setErr(msg(e)); }
  }
  async function changeStyle(body: object) {
    setStyleBusy(true); setErr("");
    try { const r = await post<{ style: Style; error?: string }>(body); setStyle(r.style); setSummary(r.style.summary); if (r.error) setErr(r.error); }
    catch (e) { setErr(msg(e)); } finally { setStyleBusy(false); }
  }
  async function saveSummary() {
    if (summary.trim() === style.summary) return;
    try { const r = await post<{ style: Style }>({ action: "style-summary", summary }); setStyle(r.style); setSummary(r.style.summary); } catch (e) { setErr(msg(e)); }
  }
  async function remove(b: BoardItem) {
    try { setBoard((await post<{ board: BoardItem[] }>({ action: "remove", id: b.id, word: b.word })).board); } catch (e) { setErr(msg(e)); }
  }

  const prompt = (title: string) => [...new Set([base, query, title].filter(Boolean))].join(" — ");
  const generate = (p: string): BuildItem => ({ kind: "generate", prompt: studioPrompt(p, style.summary) });
  const toBuild = (i: RefItem, word = query): BuildItem =>
    i.kind === "creator" && i.assetId ? { kind: "asset", assetId: i.assetId, name: i.title } : generate(word === query ? prompt(i.title) : `${word} — ${i.title}`);
  const locked = new Set(style.items.map((i) => i.id));
  const styleFull = style.items.length >= MAX_STYLE;
  const toggleStyle = (i: RefItem) => void changeStyle(locked.has(i.id) ? { action: "style-remove", id: i.id } : { action: "style-add", item: i });
  const pickOf = new Map(picks.map((p, k) => [p.id, { ...p, rank: k + 1 }]));
  const all = sections?.flatMap((s) => s.items) ?? [];
  const saved = new Set(board.filter((b) => b.word === query).map((b) => b.id));
  const groups = groupBoard(board);

  return (
    <div className="space-y-3" style={{ ["--accent" as string]: PINK }}>
      <section aria-label="My game's style" className="card space-y-2" style={{ boxShadow: `inset 3px 0 0 ${PINK}` }}>
        <div className="flex items-center justify-between">
          <div className="hud-title" style={{ color: PINK }}>🎯 MY GAME&apos;S STYLE <span className="muted text-xs">({style.items.length}/{MAX_STYLE})</span></div>
          {styleBusy && <span className="muted text-xs" role="status">Reading your style…</span>}
        </div>
        {!style.items.length ? <p className="muted text-xs">Mark up to {MAX_STYLE} references with 🎯 Style — searches, picks, ideas and Studio prompts will then match them.</p> : (
          <>
            <ul className="flex flex-wrap gap-2">
              {style.items.map((i) => (
                <li key={i.id} className="relative w-16">
                  <a href={i.link} target="_blank" rel="noopener noreferrer" aria-label={`${i.title} (opens source)`}><Thumb item={i} /></a>
                  <button className="absolute right-0 top-0 rounded-full bg-black/70 px-1.5 text-xs" onClick={() => toggleStyle(i)} disabled={styleBusy}
                    aria-label={`Remove ${i.title} from my style`}>×</button>
                </li>
              ))}
            </ul>
            <textarea className="field w-full text-xs" rows={2} maxLength={MAX_SUMMARY} aria-label="Style summary" placeholder="Style summary (palette, shapes, detail, mood)"
              value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => void saveSummary()} />
            {style.keywords.length > 0 && <p className="muted text-[0.68rem]">Keywords: {style.keywords.join(" · ")}</p>}
            {style.keywords.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={matchStyle} onChange={(e) => { setMatchStyle(e.target.checked); if (query) void search(query, false, e.target.checked); }} />
                Match my style in searches
              </label>
            )}
          </>
        )}
      </section>

      <form role="search" aria-label="Search references" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(input, true); }}>
        <input className="field min-w-0 flex-1" maxLength={60} placeholder="What do you want to build? e.g. tree" aria-label="Reference search word"
          value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn" disabled={!input.trim() || busy === "search"}>{busy === "search" ? "Searching…" : "Search"}</button>
      </form>

      {query && (
        <>
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Search elsewhere">
            <a className="chip" href={urls.pinterest(query)} target="_blank" rel="noopener noreferrer">Search on Pinterest ↗</a>
            <a className="chip" href={urls.googleImages(query)} target="_blank" rel="noopener noreferrer">Google Images ↗</a>
            <a className="chip" href={urls.creatorStore(query)} target="_blank" rel="noopener noreferrer">Creator Store ↗</a>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => void aiPick()} disabled={!!busy || !all.length}>{busy === "pick" ? "Thinking…" : "✨ Pick the best for Roblox"}</button>
            <button className="chip" onClick={() => void brainstorm()} disabled={!!busy}>{busy === "ideas" ? "Brainstorming…" : "💡 Ideas"}</button>
          </div>
        </>
      )}

      {ideas.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Ideas for ${base}`}>
          {ideas.map((idea) => (
            <li key={idea} className="flex items-center rounded-full" style={{ border: `1px solid ${PINK}55` }}>
              <button className="px-2.5 py-1 text-xs" aria-pressed={idea === query} onClick={() => void search(idea, false)} style={idea === query ? { color: PINK } : undefined}>{idea}</button>
              <button className="px-2 py-1 text-xs" aria-label={`Generate “${idea}” in Studio`} title="Generate in Studio"
                onClick={() => setBuild(generate(`${base} — ${idea}`))}>⚒</button>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="error" role="alert">{err}</p>}

      {build && (
        <div ref={buildRef} className="card space-y-2" style={{ borderColor: `${PINK}66` }} aria-label="Build in Roblox Studio">
          <div className="flex items-center justify-between"><div className="hud-title" style={{ color: PINK }}>STUDIO BUILD</div>
            <button className="chip" onClick={() => setBuild(null)} aria-label="Close Studio build">✕</button></div>
          <RobloxBuild item={build} />
        </div>
      )}

      {picks.length > 0 && (
        <section aria-label="AI picks" className="card space-y-1" style={{ boxShadow: `inset 3px 0 0 ${PINK}` }}>
          <div className="hud-title" style={{ color: PINK }}>✨ TOP PICKS FOR ROBLOX</div>
          <ol className="space-y-1 text-xs">
            {picks.map((p, k) => { const it = all.find((i) => i.id === p.id); return it && <li key={p.id}><b>{k + 1}. {it.title}</b> <span className="muted">— {p.reason}</span></li>; })}
          </ol>
        </section>
      )}

      {busy === "search" && !sections && <p className="muted text-sm" role="status">Searching the web for references…</p>}
      {sections?.map((s) => (
        <section key={s.kind} aria-label={KIND_LABEL[s.kind]} className="space-y-2">
          <div className="hud-title">{KIND_LABEL[s.kind].toUpperCase()} <span className="muted text-xs">({s.items.length})</span></div>
          {s.error ? <p className="muted text-xs">Unavailable right now: {s.error}</p>
            : !s.items.length ? <p className="muted text-xs">Nothing found for “{query}”.</p>
            : (
              <ul className="grid grid-cols-2 gap-2">
                {s.items.map((i) => (
                  <RefCard key={i.id} item={i} pick={pickOf.get(i.id)} saved={saved.has(i.id)} onSave={() => void save(i)} onBuild={() => setBuild(toBuild(i))}
                    styled={locked.has(i.id)} styleDisabled={styleBusy || (styleFull && !locked.has(i.id))} onStyle={() => toggleStyle(i)} />
                ))}
              </ul>
            )}
        </section>
      ))}

      <section aria-label="Moodboard" className="space-y-2 pt-1">
        <div className="hud-title" style={{ color: PINK }}>MOODBOARD <span className="muted text-xs">({board.length}/200)</span></div>
        {!groups.length && <p className="muted text-xs">Save references here with ☆ Save.</p>}
        {groups.map((gr) => (
          <details key={gr.word} open={gr.word === query}>
            <summary className="cursor-pointer text-sm">{gr.word} <span className="muted text-xs">· {gr.items.length}</span></summary>
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {gr.items.map((b) => (
                <li key={`${b.word}:${b.id}`} className="space-y-1">
                  <a href={b.link} target="_blank" rel="noopener noreferrer" aria-label={`${b.title} (opens source)`}><Thumb item={b} /></a>
                  <p className="truncate text-[0.7rem]" title={b.title}>{b.title}</p>
                  <div className="flex gap-1">
                    <button className="chip !px-2" onClick={() => setBuild(toBuild(b, b.word))} aria-label={`${b.kind === "creator" ? "Build" : "Generate"} ${b.title} in Studio`}>⚒</button>
                    <StyleButton compact item={b} on={locked.has(b.id)} disabled={styleBusy || (styleFull && !locked.has(b.id))} onClick={() => toggleStyle(b)} />
                    <button className="chip !px-2" onClick={() => void remove(b)} aria-label={`Remove ${b.title} from moodboard`}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </div>
  );
}

function Thumb({ item }: { item: RefItem }) {
  const [broken, setBroken] = useState(false);
  const src = allowedImage(item.thumb); // re-checked client-side: never render a URL outside the allowlist
  if (!src || broken) return <div aria-hidden className="aspect-square w-full rounded-lg" style={{ background: `linear-gradient(135deg, ${PINK}44, #0b1226 65%)` }} />;
  // eslint-disable-next-line @next/next/no-img-element -- remote CDN thumbnails from an allowlist; next/image would need remotePatterns + its proxy
  return <img src={src} alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-lg object-cover" onError={() => setBroken(true)} />;
}

function StyleButton({ item, on, disabled, onClick, compact }: { item: RefItem; on: boolean; disabled: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button className="chip !px-2" onClick={onClick} disabled={disabled} aria-pressed={on} style={on ? { color: PINK, borderColor: PINK } : undefined}
      aria-label={on ? `Remove ${item.title} from my style` : `Use ${item.title} as my game's style`} title={disabled && !on ? `Style is full (${MAX_STYLE})` : "My game's style"}>{compact ? "🎯" : "🎯 Style"}</button>
  );
}

function RefCard({ item, pick, saved, onSave, onBuild, styled, styleDisabled, onStyle }: {
  item: RefItem; pick?: Pick & { rank: number }; saved: boolean; onSave: () => void; onBuild: () => void; styled: boolean; styleDisabled: boolean; onStyle: () => void;
}) {
  return (
    <li className="card relative space-y-1 !p-2" style={pick ? { borderColor: PINK, boxShadow: `0 0 16px ${PINK}55` } : undefined}>
      {pick && <span className="absolute left-1 top-1 z-[1] rounded-full px-1.5 text-[0.65rem] font-bold text-black" style={{ background: PINK }}>✨ #{pick.rank}</span>}
      <a href={item.link} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (opens source page)`}><Thumb item={item} /></a>
      <p className="line-clamp-2 text-xs font-semibold" title={item.title}>{item.title}</p>
      <p className="muted truncate text-[0.68rem]">
        {item.creator && <>by {item.creator}</>}
        {item.verified && <span title="Verified creator" aria-label="verified creator" style={{ color: "#60a5fa" }}> ✔</span>}
        {item.subreddit && <> · r/{item.subreddit}</>}
      </p>
      {(item.votes || item.license) && (
        <p className="muted text-[0.68rem]">{item.votes ? `👍 ${item.votes.up.toLocaleString()} · ${item.votes.pct}%` : item.license}</p>
      )}
      {pick?.reason && <p className="text-[0.68rem]" style={{ color: PINK }}>{pick.reason}</p>}
      <div className="flex flex-wrap gap-1 pt-0.5">
        <button className="chip !px-2" onClick={onSave} disabled={saved} aria-label={saved ? `${item.title} saved` : `Save ${item.title} to moodboard`}>{saved ? "★ Saved" : "☆ Save"}</button>
        <button className="chip !px-2" onClick={onBuild}>{item.kind === "creator" ? "Build in Studio" : "Generate in Studio"}</button>
        <StyleButton item={item} on={styled} disabled={styleDisabled} onClick={onStyle} />
      </div>
    </li>
  );
}
