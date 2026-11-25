"use client";
import { plainError } from "@/lib/api-error-pure";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import { askConfirm } from "./ui/Dialog";
// Not imported from capsule-pure: that file pulls node:crypto into the browser bundle.
const MIN_PASSPHRASE = 10; // = capsule-pure MIN_PASSPHRASE (the server enforces it)
const fmtMB = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${Math.round(b / 1048576)} MB`);

type Backup = { name: string; at: string; kind: "nightly" | "pre-restore"; files: number; size: number };
type View = { configured: false } | { configured: true; dir: string; maxMB: number; last: { at: string; ok: boolean; bytes?: number; error?: string } | null; backups: Backup[] };
type Preview = { at: string; create: string[]; overwrite: string[]; same: number; keep: string[] };

async function post(body: object) {
  const r = await fetch("/api/capsule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r && (await r.json().catch(() => null));
  if (!r?.ok) throw new Error(j?.error ?? "ORBIT didn't answer");
  return j;
}

/** Profile → Time capsule: setup (folder, size limit, passphrase once), Back up now, and the restore wizard (pick → passphrase → preview → restore). */
export function TimeCapsuleSection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ dir: "", maxMB: 25, pass: "", pass2: "" });
  const [pick, setPick] = useState(""), [pass, setPass] = useState(""), [pv, setPv] = useState<Preview | null>(null);
  const load = useCallback(async () => {
    const j = await fetch("/api/capsule").then((r) => r.json()).catch(() => null);
    if (j?.configured !== undefined) { setV(j); if (j.configured) setForm((f) => ({ ...f, dir: j.dir, maxMB: j.maxMB })); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg("");
    try { const m = await fn(); if (m) setMsg(m); } catch (e) { setMsg(plainError(e, t("tcap.failed"))); }
    setBusy(false);
  };
  const setup = () => run(async () => {
    if (!v?.configured && form.pass !== form.pass2) return t("tcap.mismatch");
    setV(await post({ action: "setup", dir: form.dir, maxMB: form.maxMB, ...(v?.configured ? {} : { passphrase: form.pass }) }));
    setForm((f) => ({ ...f, pass: "", pass2: "" }));
    return v?.configured ? t("tcap.saved") : t("tcap.on");
  });
  const backupNow = () => run(async () => { const { backup } = await post({ action: "backup" }); await load(); return t("tcap.backupOk", { size: fmtMB(backup.bytes), n: backup.files, skipped: backup.skipped.length ? t("tcap.skipped", { list: backup.skipped.join(", ") }) : "" }); });
  const preview = () => run(async () => { setPv(null); setPv((await post({ action: "preview", name: pick, passphrase: pass })).preview); });
  const drill = () => run(async () => {
    const { drill: d } = await post({ action: "drill", name: pick, passphrase: pass });
    return d.ok ? t("tcap.drillOk", { r: d.restored, e: d.expected, b: d.backup }) : t("tcap.drillBad", { why: d.error ?? d.bad?.join("; ") ?? "" });
  });
  const restore = () => run(async () => {
    if (!(await askConfirm(t("tcap.confirm", { at: new Date(pv!.at).toLocaleString() })))) return;
    const { restored } = await post({ action: "restore", name: pick, passphrase: pass });
    setPv(null); setPass(""); await load();
    return t("tcap.restored", { n: restored.restored, safety: restored.safety });
  });

  return (
    <section className="space-y-3" aria-labelledby="capsule-title">
      <h3 id="capsule-title" className="text-sm font-semibold">{t("tcap.title")}</h3>
      <p className="muted text-sm">{t("tcap.help")}</p>
      {v && (
        <form className="space-y-2 text-sm" onSubmit={(e) => { e.preventDefault(); void setup(); }}>
          <label className="block">{t("tcap.folder")}<input className="field mt-1 w-full" value={form.dir} required placeholder={t("tcap.folderPh")} onChange={(e) => setForm({ ...form, dir: e.target.value })} /></label>
          <label className="block">{t("tcap.maxMb")}<input type="number" min={1} max={2000} className="field mt-1 block w-24" value={form.maxMB} onChange={(e) => setForm({ ...form, maxMB: Number(e.target.value) })} /></label>
          {!v.configured && (<>
            <label className="block">{t("tcap.passNew", { n: MIN_PASSPHRASE })}<input type="password" autoComplete="new-password" className="field mt-1 w-full" minLength={MIN_PASSPHRASE} required value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} /></label>
            <label className="block">{t("tcap.passAgain")}<input type="password" autoComplete="new-password" className="field mt-1 w-full" required value={form.pass2} onChange={(e) => setForm({ ...form, pass2: e.target.value })} /></label>
          </>)}
          <button className="chip" disabled={busy}>{v.configured ? t("tcap.saveFolder") : t("tcap.turnOn")}</button>
        </form>
      )}
      {v?.configured && (<>
        <p className="text-sm">
          {v.last ? (v.last.ok ? t("tcap.lastOk", { at: new Date(v.last.at).toLocaleString(), size: fmtMB(v.last.bytes ?? 0) }) : t("tcap.lastBad", { at: new Date(v.last.at).toLocaleString(), why: v.last.error ?? "" })) : t("tcap.none")}
          {" "}<button className="chip" disabled={busy} onClick={() => void backupNow()}>{t("tcap.backupNow")}</button>
        </p>
        <div className="space-y-2 text-sm">
          <h4 className="text-xs font-semibold">{t("tcap.restore")}</h4>
          <label className="block">{t("tcap.backup")}
            <select className="field mt-1 w-full" value={pick} onChange={(e) => { setPick(e.target.value); setPv(null); }}>
              <option value="">{t("tcap.pick")}</option>
              {v.backups.map((b) => <option key={b.name} value={b.name}>{new Date(b.at).toLocaleString()} · {b.kind === "pre-restore" ? t("tcap.kindSafety") : t("tcap.kindNightly")} · {t("tcap.files", { n: b.files })} · {fmtMB(b.size)}</option>)}
            </select>
          </label>
          <label className="block">{t("tcap.pass")}<input type="password" autoComplete="current-password" className="field mt-1 w-full" value={pass} onChange={(e) => { setPass(e.target.value); setPv(null); }} /></label>
          <button className="chip" disabled={busy || !pick || !pass} onClick={() => void preview()}>{t("tcap.preview")}</button>
          {" "}<button className="chip" disabled={busy || !pass} title={t("capsule.drillTitle")} onClick={() => void drill()}>{t("capsule.drill")}</button>
          {pv && (
            <div className="space-y-1" aria-live="polite">
              <p>{t("tcap.pvSummary", { o: pv.overwrite.length, c: pv.create.length, s: pv.same, k: pv.keep.length })}</p>
              {[[t("tcap.pvBack"), pv.overwrite], [t("tcap.pvCome"), pv.create]].map(([lbl, l]) => (l as string[]).length > 0 && (
                <details key={lbl as string}><summary className="muted text-xs">{lbl as string} ({(l as string[]).length})</summary><ul className="muted text-xs">{(l as string[]).map((p) => <li key={p}>{p}</li>)}</ul></details>
              ))}
              <button className="btn" disabled={busy || !pv.overwrite.length && !pv.create.length} onClick={() => void restore()}>{t("tcap.restoreThis")}</button>
            </div>
          )}
        </div>
      </>)}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}
