"use client";
import { useEffect, useState } from "react";
import type { PlayFinding, PlaytestResult } from "@/lib/roblox-pure";
import { MAX_BUGS, type Bug, type DevWorld as World, type Severity } from "@/lib/devworld-pure";
import { PINK, call } from "./RobloxBuild";

type Result = PlaytestResult & { image: string | null };
const SEV: Record<PlayFinding["severity"], Severity> = { high: "major", med: "minor", low: "polish" };

/** Look-only Roblox playtest: the bot starts play, walks around, reads the console and stops play. The owner files findings into the bug tracker one by one. */
export default function PlaytestBot({ world, commit, gameId }: { world: World | null; commit: (w: World) => boolean; gameId: string | null }) {
  const [cfg, setCfg] = useState<{ configured: boolean; help?: string } | null>(null);
  const [goal, setGoal] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<number[]>([]);
  const games = world?.games ?? [];
  const [game, setGame] = useState("");
  const pick = game || gameId; // the game selected on the Games tab, until the owner picks one here
  const target = pick && games.some((g) => g.id === pick) ? pick : (games.find((g) => g.platform === "roblox") ?? games[0])?.id ?? "";

  useEffect(() => { call<{ configured: boolean; help?: string }>().then(setCfg, (e) => setErr(e instanceof Error ? e.message : String(e))); }, []);

  const run = async () => {
    setBusy(true); setErr(""); setRes(null); setAdded([]);
    try { setRes(await call<Result>({ method: "POST", body: JSON.stringify({ action: "playtest", goal: goal.trim() }) })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const file = (f: PlayFinding, i: number) => {
    if (!world || !target) return;
    if (world.bugs.length >= MAX_BUGS) { setErr(`The bug tracker is full (${MAX_BUGS} bugs).`); return; }
    const bug: Bug = { id: crypto.randomUUID(), game: target, title: f.title, detail: `${f.evidence}\n(found by Playtest bot)`.slice(0, 2000), severity: SEV[f.severity], status: "open", created: new Date().toISOString() };
    if (commit({ ...world, bugs: [...world.bugs, bug] })) setAdded((a) => [...a, i]);
    else setErr("Couldn't add that bug. Check the Games tab.");
  };

  const btn = { background: `linear-gradient(90deg, ${PINK}, #db2777)`, boxShadow: `0 0 18px ${PINK}55` };
  return (
    <section className="glass rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Playtest bot">
      <h3 className="brand mb-2 text-sm" style={{ color: PINK }}>Playtest bot</h3>
      <div aria-live="polite" className="grid gap-2">
        {cfg && !cfg.configured ? (
          <div>
            <p className="text-xs"><b>Roblox Studio isn&apos;t connected to ORBIT yet.</b> To set it up:</p>
            <pre className="muted mt-1 whitespace-pre-wrap text-[11px]">{cfg.help}</pre>
          </div>
        ) : (
          <>
            <p className="muted text-xs">Starts play in your open Studio place, walks the character around, reads the console, then stops play. It can&apos;t edit, run code or press keys.</p>
            <input className="field w-full" maxLength={200} placeholder="What to check (optional), e.g. can you reach the shop?" aria-label="Playtest goal"
              value={goal} onChange={(e) => setGoal(e.target.value)} disabled={busy} />
            <button className="btn" style={btn} onClick={run} disabled={busy || !cfg}>{busy ? "Playtesting (up to 4 minutes)…" : "Run playtest"}</button>
          </>
        )}

        {res && (
          <div className="grid gap-2">
            <p className="text-xs" style={{ color: res.done ? "var(--mint)" : "var(--rose)" }}><b>{res.done ? "Playtest finished." : "Playtest didn't finish."}</b> {res.notes && <span className="muted">{res.notes}</span>}</p>
            {res.consoleErrors.length > 0 && (
              <div className="rounded-md p-1" style={{ background: "rgba(251,113,133,0.12)" }}>
                <b className="text-xs">Console errors ({res.consoleErrors.length})</b>
                {res.consoleErrors.map((l, i) => <code key={i} className="block whitespace-pre-wrap break-all text-[11px]">{l}</code>)}
              </div>
            )}
            {res.findings.length > 0 && games.length > 0 && (
              <label className="text-xs">File bugs under{" "}
                <select className="field py-1" value={target} onChange={(e) => setGame(e.target.value)}>
                  {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <ul className="grid gap-1">
              {res.findings.map((f, i) => (
                <li key={i} className="rounded-md border p-1 text-xs" style={{ borderColor: `${PINK}33` }}>
                  <div className="flex items-start gap-2">
                    <span><b>{f.title}</b> <span className="muted">· {f.severity}</span></span>
                    <button className="chip ml-auto shrink-0" onClick={() => file(f, i)} disabled={!world || !target || added.includes(i)}
                      aria-label={`Add bug ${f.title}`}>{added.includes(i) ? "Added" : "Add to bugs"}</button>
                  </div>
                  {f.evidence && <code className="mt-0.5 block whitespace-pre-wrap break-all text-[11px]">{f.evidence}</code>}
                </li>
              ))}
            </ul>
            {res.done && !res.findings.length && <p className="muted text-xs">The bot reported no problems.</p>}
            {res.image?.startsWith("data:image/png;base64,") && res.image.length < 3_100_000 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={res.image} alt="Last screenshot from the playtest" className="w-full rounded-md" />
            )}
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}
