"use client";
import { useEffect, useState } from "react";
import type { PlayFinding, PlaytestResult } from "@/lib/roblox-pure";
import { MAX_BUGS, type Bug, type DevWorld as World, type Severity } from "@/lib/devworld-pure";
import { PINK, call } from "./RobloxBuild";
import { GRID_ERRORS_KEY } from "@/lib/grid-pure";
import { useT } from "./i18n";

type Result = PlaytestResult & { image: string | null };
const SEV: Record<PlayFinding["severity"], Severity> = { high: "major", med: "minor", low: "polish" };

/** Look-only Roblox playtest: the bot starts play, walks around, reads the console and stops play. The owner files findings into the bug tracker one by one. */
export default function PlaytestBot({ world, commit, gameId }: { world: World | null; commit: (w: World) => boolean; gameId: string | null }) {
  const { t } = useT();
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
    try {
      const r = await call<Result>({ method: "POST", body: JSON.stringify({ action: "playtest", goal: goal.trim() }) });
      setRes(r);
      try { localStorage.setItem(GRID_ERRORS_KEY, r.consoleErrors.join("\n")); } catch { /* no storage: the Grid tab just won't see them */ }
    }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const file = (f: PlayFinding, i: number) => {
    if (!world || !target) return;
    if (world.bugs.length >= MAX_BUGS) { setErr(t("ptbot.full", { n: MAX_BUGS })); return; }
    const bug: Bug = { id: crypto.randomUUID(), game: target, title: f.title, detail: `${f.evidence}\n(found by Playtest bot)`.slice(0, 2000), severity: SEV[f.severity], status: "open", created: new Date().toISOString() };
    if (commit({ ...world, bugs: [...world.bugs, bug] })) setAdded((a) => [...a, i]);
    else setErr(t("ptbot.addFail"));
  };

  const btn = { background: `linear-gradient(90deg, ${PINK}, #db2777)`, boxShadow: `0 0 18px ${PINK}55` };
  return (
    <section className="glass rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label={t("ptbot.title")}>
      <h3 className="brand mb-2 text-sm" style={{ color: PINK }}>{t("ptbot.title")}</h3>
      <div aria-live="polite" className="grid gap-2">
        {cfg && !cfg.configured ? (
          <div>
            <p className="text-xs"><b>{t("ptbot.noStudio")}</b> {t("ptbot.setup")}</p>
            <pre className="muted mt-1 whitespace-pre-wrap text-[11px]">{cfg.help}</pre>
          </div>
        ) : (
          <>
            <p className="muted text-xs">{t("ptbot.help")}</p>
            <input className="field w-full" maxLength={200} placeholder={t("ptbot.goalPh")} aria-label={t("ptbot.goal")}
              value={goal} onChange={(e) => setGoal(e.target.value)} disabled={busy} />
            <button className="btn" style={btn} onClick={run} disabled={busy || !cfg}>{busy ? t("ptbot.running") : t("ptbot.run")}</button>
          </>
        )}

        {res && (
          <div className="grid gap-2">
            <p className="text-xs" style={{ color: res.done ? "var(--mint)" : "var(--rose)" }}><b>{res.done ? t("ptbot.done") : t("ptbot.notDone")}</b> {res.notes && <span className="muted">{res.notes}</span>}</p>
            {res.consoleErrors.length > 0 && (
              <div className="rounded-md p-1" style={{ background: "rgba(251,113,133,0.12)" }}>
                <b className="text-xs">{t("ptbot.consoleErr", { n: res.consoleErrors.length })}</b>
                {res.consoleErrors.map((l, i) => <code key={i} className="block whitespace-pre-wrap break-all text-[11px]">{l}</code>)}
              </div>
            )}
            {res.findings.length > 0 && games.length > 0 && (
              <label className="text-xs">{t("ptbot.fileUnder")}{" "}
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
                      aria-label={t("ptbot.addL", { title: f.title })}>{added.includes(i) ? t("ptbot.added") : t("ptbot.add")}</button>
                  </div>
                  {f.evidence && <code className="mt-0.5 block whitespace-pre-wrap break-all text-[11px]">{f.evidence}</code>}
                </li>
              ))}
            </ul>
            {res.done && !res.findings.length && <p className="muted text-xs">{t("ptbot.clean")}</p>}
            {res.image?.startsWith("data:image/png;base64,") && res.image.length < 3_100_000 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={res.image} alt={t("ptbot.shot")} className="w-full rounded-md" />
            )}
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}
