"use client";
import { plainError } from "@/lib/api-error-pure";
import { useEffect, useState } from "react";
import type { Stored } from "@/lib/lessons-pure";
import { useT } from "./i18n";
import { askConfirm } from "./ui/Dialog";

// "What I learned about you" (Profile) and the one-tap chip CORE shows after a correction. Data: /api/lessons (lessons.ts).

type View = { proposed: Stored[]; kept: Stored[]; rejected: number; minedAt: string | null };

async function post(body: object): Promise<View> {
  const r = await fetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as View;
}
const pct = (c: number) => `${Math.round(c * 100)}%`;
const SOURCE: Record<string, string> = { event: "ledger event", proposal: "proposal", clip: "clip review", prospect: "outreach", niche: "niche", message: "your chat message" };

function Evidence({ l }: { l: Stored }) {
  const { t } = useT();
  return (
    <details className="text-xs">
      <summary className="link muted">{t(l.area === "correction" ? "less.basedCorr" : "less.basedDec", { n: l.support, p: pct(l.confidence) })}</summary>
      <ul className="muted mt-1 space-y-0.5">{l.evidence.map((e) => { const i = e.indexOf(":"); return <li key={e}>{SOURCE[e.slice(0, i)] ?? e.slice(0, i)} <code>{e.slice(i + 1)}</code></li>; })}</ul>
    </details>
  );
}

export function LessonsSection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/lessons", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setMsg(t("less.loadFail")) : setV(j))).catch((e) => setMsg(plainError(e, t("less.loadFail")))); }, []);
  const act = async (body: object, done = "") => {
    setBusy(true); setMsg("");
    try { setV(await post(body)); setMsg(done); } catch (e) { setMsg(plainError(e, t("less.saveFail"))); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-2" aria-labelledby="lessons-h">
      <h3 id="lessons-h" className="h3">{t("profile.lessons")}</h3>
      <p className="muted text-xs">{t("less.help")}</p>
      {!v ? (!msg && <p className="muted text-sm">{t("less.loading")}</p>) : (<>
        <ul className="space-y-2" aria-label={t("less.new")}>
          {v.proposed.map((l) => (
            <li key={l.id} className="card space-y-1 text-sm">
              <div>{l.text}</div>
              <Evidence l={l} />
              <div className="flex gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => act({ id: l.id, decision: "keep" }, t("less.keptMsg"))}>{t("less.keep")}</button>
                <button type="button" className="chip" disabled={busy} onClick={() => act({ id: l.id, decision: "reject" }, t("less.rejMsg"))}>{t("less.notTrue")}</button>
              </div>
            </li>
          ))}
          {!v.proposed.length && <li className="muted text-sm">{t("less.nothing")}</li>}
        </ul>
        {!!v.kept.length && (
          <details>
            <summary className="link text-sm">{t("less.kept", { n: v.kept.length })}</summary>
            <ul className="mt-2 space-y-1">{v.kept.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                <div><div>{l.text}</div><Evidence l={l} /></div>
                <button type="button" className="chip shrink-0" disabled={busy} onClick={async () => (await askConfirm(t("less.forgetQ"))) && act({ id: l.id, decision: "reject" }, t("less.forgotMsg"))}>{t("less.forget")}</button>
              </li>))}</ul>
          </details>
        )}
        <div className="muted flex flex-wrap items-center gap-2 text-xs">
          <span>{t("less.last", { at: v.minedAt ? new Date(v.minedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : t("less.notYet") })}{v.rejected ? ` · ${t("less.rejected", { n: v.rejected })}` : ""}</span>
          <button type="button" className="chip" disabled={busy} onClick={() => act({ action: "mine" }, t("less.lookedMsg"))}>{t("less.lookAgain")}</button>
        </div>
      </>)}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}

/** After a correction in chat: "Noted: …" with Keep / Not true. */
export function LessonChip({ lesson }: { lesson: { id: string; text: string } }) {
  const { t } = useT();
  const [state, setState] = useState<"" | "busy" | "kept" | "dropped" | "error">("");
  const act = (decision: "keep" | "reject") => { setState("busy"); post({ id: lesson.id, decision }).then(() => setState(decision === "keep" ? "kept" : "dropped"), () => setState("error")); };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={t("less.chip")}>
      <span className="muted">📝 {state === "kept" ? t("less.chipKept") : state === "dropped" ? t("less.chipDropped") : t("less.chipAsk")} {lesson.text}</span>
      {(state === "" || state === "error") && <>
        <button type="button" className="chip" onClick={() => act("keep")}>{t("less.keep")}</button>
        <button type="button" className="chip" onClick={() => act("reject")}>{t("less.notTrue")}</button>
        {state === "error" && <span className="error">{t("less.notSaved")}</span>}
      </>}
    </div>
  );
}
