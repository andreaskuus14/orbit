"use client";
import { useCallback, useEffect, useState } from "react";
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
    try { const m = await fn(); if (m) setMsg(m); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  const setup = () => run(async () => {
    if (!v?.configured && form.pass !== form.pass2) return "The passphrases don't match";
    setV(await post({ action: "setup", dir: form.dir, maxMB: form.maxMB, ...(v?.configured ? {} : { passphrase: form.pass }) }));
    setForm((f) => ({ ...f, pass: "", pass2: "" }));
    return v?.configured ? "Saved" : "Time capsule is on. Write the passphrase down somewhere safe: without it no backup can be opened.";
  });
  const backupNow = () => run(async () => { const { backup } = await post({ action: "backup" }); await load(); return `Backup OK (${fmtMB(backup.bytes)}, ${backup.files} files${backup.skipped.length ? `; skipped over the size limit: ${backup.skipped.join(", ")}` : ""})`; });
  const preview = () => run(async () => { setPv(null); setPv((await post({ action: "preview", name: pick, passphrase: pass })).preview); });
  const drill = () => run(async () => {
    const { drill: d } = await post({ action: "drill", name: pick, passphrase: pass });
    return d.ok ? `Drill passed: ${d.restored}/${d.expected} files restored and parsed from ${d.backup}.` : `Drill failed: ${d.error ?? d.bad?.join("; ")}`;
  });
  const restore = () => run(async () => {
    if (!confirm(`Restore the backup from ${new Date(pv!.at).toLocaleString()}? ORBIT first saves a safety backup of how things are now.`)) return;
    const { restored } = await post({ action: "restore", name: pick, passphrase: pass });
    setPv(null); setPass(""); await load();
    return `Restored ${restored.restored} files. Safety backup: ${restored.safety}. Restart ORBIT so every part reloads the restored data.`;
  });

  return (
    <section className="space-y-3" aria-labelledby="capsule-title">
      <h3 id="capsule-title" className="text-sm font-semibold">Time capsule</h3>
      <p className="muted text-sm">A nightly encrypted copy of ORBIT&apos;s local data (its .json stores and the vault index) into a folder you pick, like an external drive or your OneDrive folder. ORBIT only writes the file there; it uploads nothing. Keeps 14 nightly and 8 weekly backups.</p>
      {v && (
        <form className="space-y-2 text-sm" onSubmit={(e) => { e.preventDefault(); void setup(); }}>
          <label className="block">Backup folder (full path)<input className="field mt-1 w-full" value={form.dir} required placeholder="E:\ORBIT backups" onChange={(e) => setForm({ ...form, dir: e.target.value })} /></label>
          <label className="block">Skip files bigger than (MB)<input type="number" min={1} max={2000} className="field mt-1 block w-24" value={form.maxMB} onChange={(e) => setForm({ ...form, maxMB: Number(e.target.value) })} /></label>
          {!v.configured && (<>
            <label className="block">Passphrase (at least {MIN_PASSPHRASE} characters; set once, never stored)<input type="password" autoComplete="new-password" className="field mt-1 w-full" minLength={MIN_PASSPHRASE} required value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} /></label>
            <label className="block">Passphrase again<input type="password" autoComplete="new-password" className="field mt-1 w-full" required value={form.pass2} onChange={(e) => setForm({ ...form, pass2: e.target.value })} /></label>
          </>)}
          <button className="chip" disabled={busy}>{v.configured ? "Save folder and limit" : "Turn on time capsule"}</button>
        </form>
      )}
      {v?.configured && (<>
        <p className="text-sm">
          {v.last ? (v.last.ok ? `Last backup ${new Date(v.last.at).toLocaleString()}: OK (${fmtMB(v.last.bytes ?? 0)})` : `Last backup ${new Date(v.last.at).toLocaleString()} failed: ${v.last.error}`) : "No backup yet; the first one runs tonight."}
          {" "}<button className="chip" disabled={busy} onClick={() => void backupNow()}>Back up now</button>
        </p>
        <div className="space-y-2 text-sm">
          <h4 className="text-xs font-semibold">Restore</h4>
          <label className="block">Backup
            <select className="field mt-1 w-full" value={pick} onChange={(e) => { setPick(e.target.value); setPv(null); }}>
              <option value="">Pick a backup…</option>
              {v.backups.map((b) => <option key={b.name} value={b.name}>{new Date(b.at).toLocaleString()} · {b.kind === "pre-restore" ? "safety (before a restore)" : "nightly"} · {b.files} files · {fmtMB(b.size)}</option>)}
            </select>
          </label>
          <label className="block">Passphrase<input type="password" autoComplete="current-password" className="field mt-1 w-full" value={pass} onChange={(e) => { setPass(e.target.value); setPv(null); }} /></label>
          <button className="chip" disabled={busy || !pick || !pass} onClick={() => void preview()}>Preview changes</button>
          {" "}<button className="chip" disabled={busy || !pass} title="Restores into a temporary folder, checks every file, then deletes it. Your data isn't touched." onClick={() => void drill()}>Run restore drill</button>
          {pv && (
            <div className="space-y-1" aria-live="polite">
              <p>{pv.overwrite.length} file(s) go back to the backup&apos;s version, {pv.create.length} come back, {pv.same} unchanged. {pv.keep.length} newer file(s) not in the backup stay as they are.</p>
              {[["Back to the backup's version", pv.overwrite], ["Come back", pv.create]].map(([t, l]) => (l as string[]).length > 0 && (
                <details key={t as string}><summary className="muted text-xs">{t as string} ({(l as string[]).length})</summary><ul className="muted text-xs">{(l as string[]).map((p) => <li key={p}>{p}</li>)}</ul></details>
              ))}
              <button className="btn" disabled={busy || !pv.overwrite.length && !pv.create.length} onClick={() => void restore()}>Restore this backup</button>
            </div>
          )}
        </div>
      </>)}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}
