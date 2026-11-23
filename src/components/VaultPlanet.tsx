"use client";
// VAULT in the planet look (reports/design-language.md): one calm shell. Main job first: one box that finds a file by its name or
// a word inside it (live), and asks ORBIT when the answer isn't a file. Then Needs you → Working on it (uploads, sync, podcast,
// notes, fields: the shared Progress card) → what ORBIT changed here (TIME MACHINE, with Undo) → the files with a precise
// storage map by type. A file opens in a sheet (VaultFileSheet). Trash, cloud-only files, podcast and workspaces live in "…".
// Data: /api/vault (rules: lib/vault-pure.ts, vault-meta-pure.ts, vault-ui-pure.ts). Nothing here sends anything outside ORBIT:
// the cloud copy goes to his own Supabase project; "Save a copy to Memory" asks first.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent as RKey } from "react";
import "@/app/vault-planet.css";
import { PlanetShell, Section, Button, Chip, Row, Card, WorkCard, Empty, Loading, ErrorState, Sheet, Toaster, toast, uiSound, IconSend, IconPlus, type MenuItem } from "./ui";
import { useT } from "./i18n";
import { VOICE_ASK } from "./voice/bus";
import { openTarget } from "./NeedsYou";
import { WorkspacePanel } from "./WorkspacePanel";
import { VaultFileSheet, type Ctx } from "./VaultFileSheet";
import { call, Confirm, thumbUrl, type VFile } from "./VaultBits";
import { MAX_FILE, MAX_TOTAL, type Kind } from "@/lib/vault-pure";
import { TRASH_DAYS, searchVerdict } from "@/lib/vault-meta-pure";
import { around, fileActions, fileDate, filterFiles, highlight, jobCard, plainError, searchesInside, size, statusLine, storageMap, type Group, type Sort, type VaultChange } from "@/lib/vault-ui-pure";
import { planetNeeds, type Need } from "@/lib/needs-you-pure";
import { fromNeed } from "@/lib/progress-pure";

type Trashed = { id: string; name: string; size: number; trashedAt: number; expiresAt: number };
type Job = { id: string; title: string; done?: number; total?: number; now?: string | null; at: number };
const PAGE = 60;
const TAG: Record<Kind, string> = { image: "IMG", video: "VID", audio: "AUD", pdf: "PDF", text: "TXT", doc: "DOC", other: "FILE" };
const JSON_POST = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const ask = (text: string) => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));

export function VaultPlanet({ onClose }: { onClose?: () => void }) {
  const { t, lang } = useT();
  const [files, setFiles] = useState<VFile[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [trash, setTrash] = useState<Trashed[]>([]);
  const [cloudOnly, setCloudOnly] = useState<{ name: string; size: number }[]>([]);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [changes, setChanges] = useState<VaultChange[]>([]);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "all">("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [hits, setHits] = useState<Record<string, string> | null>(null);
  const [notIndexed, setNotIndexed] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sheet, setSheet] = useState<null | "trash" | "cloud" | "podcast" | "workspaces">(null);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [pod, setPod] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null), searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ files: VFile[]; cloudOnly?: { name: string; size: number }[]; cloudError?: string | null; trash?: Trashed[] }>("/api/vault");
      setFiles(r.files); setTrash(r.trash ?? []); setCloudOnly(r.cloudOnly ?? []); setCloudError(r.cloudError ?? null); setLoadErr(false);
    } catch { setLoadErr(true); }
    call<{ changes: VaultChange[] }>("/api/vault?changes=1").then((r) => setChanges(r.changes ?? []), () => {});
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let live = true;
    call<{ items?: Need[] }>(`/api/needs-you?lang=${lang}`).then((j) => { if (live) setNeeds(planetNeeds("vault", j.items ?? []).own); }, () => {});
    return () => { live = false; };
  }, [lang]);
  const needCount = needs.length;
  const prevNeeds = useRef(0);
  useEffect(() => { if (needCount > prevNeeds.current) uiSound("needs"); prevNeeds.current = needCount; }, [needCount]);

  // One search: names filter at once; words inside come from the server (debounced, a newer search cancels an older one).
  useEffect(() => {
    if (!searchesInside(q)) { setHits(null); setNotIndexed([]); setSearching(false); return; }
    const ac = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      call<{ results: { name: string; snippet: string }[]; notIndexed?: string[] }>(`/api/vault?content=1&q=${encodeURIComponent(q.trim())}`, { signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) { setHits(Object.fromEntries(r.results.map((x) => [x.name, x.snippet]))); setNotIndexed(r.notIndexed ?? []); } })
        .catch(() => { if (!ac.signal.aborted) setHits({}); })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, 220);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [q, files]);
  useEffect(() => { setLimit(PAGE); }, [q, group, sort]);

  // "/" jumps to the search box (unless he is typing somewhere).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!searchRef.current?.isConnected) return;
      e.preventDefault(); searchRef.current.focus();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  /** A local job shows in Working on it while it runs; the result comes as a toast. */
  const run = useCallback(async <T,>(title: string, fn: (step: (done: number, total: number, now?: string) => void) => Promise<T>, kind = "job"): Promise<T | undefined> => {
    const id = `${kind}:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setJobs((js) => [...js, { id, title, at: Date.now() }]);
    const step = (done: number, total: number, now?: string) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, done, total, now: now ?? null } : j)));
    try { return await fn(step); }
    catch (e) { toast({ tone: "error", text: plainError(e instanceof Error ? e.message : "", t("vlt.err.generic"), { localOff: t("vlt.err.localOff"), cloudDown: t("vlt.err.cloudDown") }) }); return undefined; }
    finally { setJobs((js) => js.filter((j) => j.id !== id)); }
  }, [t]);

  const upload = useCallback(async (list: FileList | File[]) => {
    const arr = [...list];
    if (!arr.length) return;
    if (jobs.some((j) => j.id.startsWith("up:"))) { toast({ tone: "error", text: t("vlt.up.wait") }); return; }
    const id = `up:${Date.now()}`;
    setJobs((js) => [...js, { id, title: t("vlt.up.title", { n: arr.length }), done: 0, total: arr.length, at: Date.now() }]);
    const saved: string[] = [], errors: string[] = [];
    let cloudFailed = 0, pending = false;
    for (const [i, f] of arr.entries()) { // one file per request: the middleware caps a body at 45 MB
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, done: i, now: f.name } : j)));
      if (f.size > MAX_FILE) { errors.push(t("vlt.up.tooBig", { name: f.name, size: size(f.size, lang) })); continue; }
      try {
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/vault", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({})) as { saved?: string[]; errors?: string[]; error?: string; cloud?: string };
        saved.push(...(j.saved ?? []));
        if (j.cloud === "pending") pending = true; else if (j.cloud?.startsWith("failed")) cloudFailed++;
        errors.push(...(j.errors ?? []), ...(j.error ? [`${f.name}: ${j.error}`] : []));
        if (!r.ok && !j.error && !j.errors?.length) errors.push(t("vlt.up.failed", { name: f.name }));
      } catch { errors.push(t("vlt.up.failed", { name: f.name })); }
    }
    setJobs((js) => js.filter((j) => j.id !== id));
    if (fileRef.current) fileRef.current.value = "";
    await load();
    if (saved.length) toast({ tone: "done", text: saved.length === 1 ? t("vlt.up.savedOne", { name: saved[0] }) : t("vlt.up.saved", { n: saved.length }) + (pending ? ` ${t("vlt.up.pending")}` : cloudFailed ? ` ${t("vlt.up.cloudLater")}` : ""),
      action: saved.length === 1 ? { label: t("common.open"), onClick: () => setOpen(saved[0]) } : undefined });
    if (errors.length) toast({ tone: "error", text: errors.length === 1 ? errors[0] : t("vlt.up.errors", { n: errors.length, first: errors[0] }) });
  }, [jobs, load, t, lang]);

  const sync = () => run(t("vlt.job.sync"), async () => {
    const r = await call<{ uploaded: number; failed: number; remaining: number; firstError: string | null }>("/api/vault", JSON_POST({ action: "sync" }));
    await load();
    if (r.failed) toast({ tone: "error", text: t("vlt.sync.failed", { n: r.failed }) });
    else toast({ tone: "done", text: r.uploaded ? t("vlt.sync.done", { n: r.uploaded }) + (r.remaining ? ` ${t("vlt.sync.more", { n: r.remaining })}` : "") : t("vlt.sync.none") });
  }, "sync");
  const untrash = async (x: { id: string; name: string }) => {
    try { const r = await call<{ name: string }>("/api/vault", JSON_POST({ action: "untrash", id: x.id })); toast({ tone: "done", text: t("vault.restored", { name: r.name }) }); }
    catch (e) { toast({ tone: "error", text: plainError(e instanceof Error ? e.message : "", t("vlt.err.generic"), { localOff: t("vlt.err.localOff"), cloudDown: t("vlt.err.cloudDown") }) }); }
    await load();
  };
  const purge = async (x: Trashed) => {
    try { await call("/api/vault", JSON_POST({ action: "purge", id: x.id })); toast({ text: t("vlt.trash.purged", { name: x.name }) }); }
    catch { toast({ tone: "error", text: t("vlt.err.generic") }); }
    await load();
  };
  const restore = (name: string) => run(t("vlt.job.restore", { name }), async () => {
    const r = await call<{ name: string }>("/api/vault", JSON_POST({ action: "restore", name }));
    await load(); toast({ tone: "done", text: t("vlt.cloud.restored", { name: r.name }), action: { label: t("common.open"), onClick: () => setOpen(r.name) } });
  });
  const undoChange = async (c: VaultChange) => {
    try {
      const r = await fetch("/api/time-machine", JSON_POST({ tm: c.id }));
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error || "");
      toast({ tone: "done", text: t("vlt.changes.undone", { name: c.name }) });
    } catch (e) { toast({ tone: "error", text: plainError(e instanceof Error ? e.message : "", t("vlt.changes.undoFailed"), { localOff: t("vlt.err.localOff"), cloudDown: t("vlt.err.cloudDown") }) }); }
    await load();
  };
  const podcast = (names: string[]) => run(t("vlt.job.podcast", { n: names.length }), async (step) => {
    step(0, 1, t("vlt.pod.now"));
    const res = await fetch("/api/vault", JSON_POST({ action: "podcast", names }));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "");
    const url = URL.createObjectURL(await res.blob());
    setPod((old) => { if (old) URL.revokeObjectURL(old); return url; });
    toast({ tone: "done", text: t("vlt.pod.done"), action: { label: t("common.open"), onClick: () => setSheet("podcast") } });
  }, "pod");
  useEffect(() => () => { if (pod) URL.revokeObjectURL(pod); }, [pod]);

  const all = useMemo(() => files ?? [], [files]);
  const shown = useMemo(() => filterFiles(all, { q, group, sort, hits }), [all, q, group, sort, hits]);
  const map = useMemo(() => storageMap(all), [all]);
  const bytes = map.reduce((a, g) => a + g.bytes, 0);
  const noCloud = cloudError ? 0 : all.filter((f) => f.sync === "failed" || (f.cloud === false && f.sync !== "pending")).length;
  const failedCloud = cloudError ? 0 : all.filter((f) => f.sync === "failed").length;
  const openFile = all.find((f) => f.name === open) ?? null;
  useEffect(() => { if (open && files && !openFile) setOpen(null); }, [open, files, openFile]); // gone (trashed, undone elsewhere)

  const ctx: Ctx = { run, load, files: all, changes, setOpen, untrash, undoChange };
  const menu: MenuItem[] = [
    { label: t("vlt.menu.add"), icon: <IconPlus />, onSelect: () => fileRef.current?.click() },
    { label: t("vlt.menu.sync"), onSelect: () => void sync(), disabled: jobs.some((j) => j.id.startsWith("sync:")) },
    "separator",
    { label: trash.length ? t("vlt.menu.trashN", { n: trash.length }) : t("vault.trash"), onSelect: () => setSheet("trash") },
    { label: cloudOnly.length ? t("vlt.menu.cloudN", { n: cloudOnly.length }) : t("vlt.menu.cloud"), onSelect: () => setSheet("cloud") },
    { label: t("vlt.menu.podcast"), onSelect: () => setSheet("podcast") },
    { label: t("vlt.menu.workspaces"), onSelect: () => setSheet("workspaces") },
  ];

  const submit = (e: FormEvent) => { e.preventDefault(); const v = q.trim(); if (!v) { searchRef.current?.focus(); return; } uiSound("send"); ask(v); };
  const onSearchKey = (e: RKey<HTMLInputElement>) => {
    if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); }
    if (e.key === "ArrowDown" && shown.length) { e.preventDefault(); (document.querySelector(".vlt-list .pu-row") as HTMLElement | null)?.focus(); }
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDrag(true); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDrag(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); },
  };
  const searchingInside = searchesInside(q);
  const status = loadErr && files === null ? t("vlt.err.list") : files === null ? t("vlt.loading") : statusLine({ count: all.length, bytes, limit: MAX_TOTAL, noCloud, cloudError: !!cloudError }, lang);
  const examples = [1, 2, 3].map((n) => t(`ph.vault.ex${n}` as "ph.vault.ex1"));
  const sortLabel = { newest: t("vlt.sort.newest"), name: t("vlt.sort.name"), size: t("vlt.sort.size") };

  return (
    <div className="vlt-wrap" {...dropProps} data-drag={drag || undefined}>
      <Toaster dismissLabel={t("vlt.dismiss")} />
      <input ref={fileRef} type="file" multiple hidden tabIndex={-1} aria-label={t("vlt.add")} onChange={(e) => { if (e.target.files) void upload(e.target.files); }} />
      <PlanetShell planet="vault" title={t("vlt.title")} status={status} menu={menu} menuLabel={t("vlt.menu.label")} onClose={onClose} closeLabel={t("vlt.backGalaxy")} className="vlt"
        sheet={<>
          <Sheet open={!!openFile} title={openFile?.name ?? ""} onClose={() => setOpen(null)} closeLabel={t("vlt.close")}>
            {openFile && <VaultFileSheet key={openFile.name} file={openFile} ctx={ctx} />}
          </Sheet>
          <Sheet open={sheet === "trash"} title={t("vault.trash")} onClose={() => setSheet(null)} closeLabel={t("vlt.close")}>
            <p className="vlt-note">{t("vault.trashNote", { days: TRASH_DAYS })}</p>
            {!trash.length ? <Empty title={t("vlt.trash.empty")} text={t("vlt.trash.emptyText", { days: TRASH_DAYS })} /> : (
              <ul className="pu-list">{trash.map((x) => <li key={x.id}><Row title={x.name} sub={`${size(x.size, lang)} · ${t("vault.expires", { at: fileDate(x.expiresAt, lang) })}`}
                trail={<><Button size="sm" onClick={() => void untrash(x)}>{t("vault.restore")}</Button><Confirm label={t("vlt.trash.purge")} sure={t("vlt.trash.sure")} onYes={() => void purge(x)} /></>} /></li>)}</ul>)}
          </Sheet>
          <Sheet open={sheet === "cloud"} title={t("vlt.menu.cloud")} onClose={() => setSheet(null)} closeLabel={t("vlt.close")}>
            <p className="vlt-note">{t("vlt.cloud.note")}</p>
            {cloudError ? <ErrorState title={t("vlt.cloud.down")} text={t("vlt.cloud.downText")} retryLabel={t("vlt.retry")} onRetry={() => void load()} />
              : !cloudOnly.length ? <Empty title={t("vlt.cloud.empty")} text={t("vlt.cloud.emptyText")} /> : (
              <ul className="pu-list">{cloudOnly.map((c) => <li key={c.name}><Row title={c.name} sub={size(c.size, lang)}
                trail={<Button size="sm" onClick={() => void restore(c.name)}>{t("vlt.cloud.get")}</Button>} /></li>)}</ul>)}
          </Sheet>
          <Sheet open={sheet === "podcast"} title={t("vlt.menu.podcast")} onClose={() => setSheet(null)} closeLabel={t("vlt.close")}>
            <PodcastPicker files={shown.filter((f) => fileActions(f, 0).podcast)} busy={jobs.some((j) => j.id.startsWith("pod:"))} onMake={(n) => void podcast(n)} audio={pod} />
          </Sheet>
          <Sheet open={sheet === "workspaces"} title={t("vlt.menu.workspaces")} onClose={() => setSheet(null)} closeLabel={t("vlt.close")}>
            <div className="vlt-legacy">{sheet === "workspaces" && <WorkspacePanel />}</div>
          </Sheet>
        </>}>
        {/* Main job: find a file or a word inside one; Enter asks ORBIT */}
        <form className="pu-ask" onSubmit={submit} role="search">
          <div className="pu-ask-field vlt-find">
            <svg className="vlt-find-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <input ref={searchRef} className="pu-ask-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} maxLength={200}
              placeholder={t("vlt.find.ph")} aria-label={t("vlt.find.label")} aria-describedby="vlt-find-hint" aria-controls="vlt-files" enterKeyHint="send" />
            <Button type="submit" variant="primary" icon={<IconSend />} label={t("vlt.find.ask")} disabled={!q.trim()} />
          </div>
          <p id="vlt-find-hint" className="vlt-hint" aria-live="polite" data-q={q.trim() ? "" : undefined}>
            {q.trim() ? (searching ? t("vlt.find.searching") : searchingInside ? t("vlt.find.found", { n: shown.length }) : t("vlt.find.short")) : t("vlt.find.hint")}
          </p>
          {!q && <div className="pu-chips">{examples.map((x) => <Chip key={x} onClick={() => { setQ(x); searchRef.current?.focus(); }}>{x}</Chip>)}</div>}
        </form>

        {needs.length > 0 && <Section title={t("vlt.needs")} count={needs.length}>
          <ul className="pu-list vlt-cards">{needs.slice(0, 3).map((n) => <WorkCard key={n.ref} p={fromNeed(n, t(`needs.ask.${n.cause}` as "needs.ask.failed"), t("common.open"))}
            onAction={() => openTarget(n.act.open, (id) => { location.hash = `o=operations&k=task&id=${encodeURIComponent(id)}`; }, (id) => { location.hash = `o=agents&k=goal&id=${encodeURIComponent(id)}`; })} />)}</ul>
        </Section>}
        {failedCloud > 0 && !needs.length && <Card tone="needs" title={t("vlt.needs.cloud", { n: failedCloud })} sub={t("vlt.needs.cloudSub")}
          actions={<Button size="sm" variant="primary" onClick={() => void sync()}>{t("vlt.retry")}</Button>} />}

        {jobs.length > 0 && <Section title={t("vlt.working")} count={jobs.length}>
          <ul className="pu-list vlt-cards">{jobs.map((j) => <WorkCard key={j.id} p={jobCard(j)} onAction={() => {}} />)}</ul>
        </Section>}

        {changes.length > 0 && <Section title={t("vlt.changes")} count={changes.filter((c) => c.open).length || undefined}>
          <ul className="pu-list">{changes.slice(0, 3).map((c) => <li key={c.id}><Row lead={<span className="vlt-dot" data-open={c.open || undefined} />} title={c.made ? t("vlt.changes.made", { name: c.name }) : c.redo ? t("vlt.changes.removed", { name: c.name }) : c.title}
            sub={`${fileDate(Date.parse(c.at), lang)}${c.why ? ` · ${c.why}` : ""}`}
            trail={c.open ? <Button size="sm" variant="ghost" onClick={() => void undoChange(c)}>{c.redo ? t("vlt.changes.redo") : t("vlt.changes.undo")}</Button> : <span>{t("vlt.changes.wasUndone")}</span>} /></li>)}</ul>
        </Section>}

        <Section id="vlt-files" title={q.trim() ? t("vlt.files.found") : t("vlt.files")} count={files ? shown.length : undefined}
          action={<span className="vlt-head-actions">
            <SortButton value={sort} labels={sortLabel} onChange={setSort} label={t("vlt.sort.label")} />
            <Button size="sm" variant="ghost" icon={<IconPlus />} onClick={() => fileRef.current?.click()}>{t("vlt.add")}</Button>
          </span>}>
          {loadErr ? <ErrorState title={t("vlt.err.list")} text={t("vlt.err.listText")} retryLabel={t("vlt.retry")} onRetry={() => { setLoadErr(false); void load(); }} />
            : files === null ? <Loading rows={5} label={t("vlt.loading")} />
            : !all.length ? <Empty title={t("vlt.empty")} text={t("vlt.emptyText")} action={<Button size="sm" icon={<IconPlus />} onClick={() => fileRef.current?.click()}>{t("vlt.add")}</Button>} />
            : <>
              <StorageMap map={map} total={bytes} group={group} onGroup={setGroup} />
              {!shown.length ? (
                <Empty title={q.trim() ? t("vlt.none.title", { q: q.trim() }) : t("vlt.none.group")}
                  text={q.trim() ? (searchVerdict(0, notIndexed.length) === "notIndexed" && searchingInside ? t("vlt.none.partly", { n: notIndexed.length }) : t("vlt.none.text")) : undefined}
                  action={q.trim() ? <Button size="sm" onClick={() => ask(q.trim())}>{t("vlt.find.ask")}</Button> : <Button size="sm" variant="ghost" onClick={() => setGroup("all")}>{t("vlt.showAll")}</Button>} />
              ) : (
                <ul className="pu-list vlt-list" aria-label={t("vlt.files")}>
                  {shown.slice(0, limit).map((f) => <li key={f.name}><FileRow f={f} q={q} snippet={hits?.[f.name]} lang={lang} cloudOk={!cloudError} onOpen={() => setOpen(f.name)} t={t} /></li>)}
                </ul>)}
              {shown.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 200)}>{t("vlt.more", { n: shown.length - limit })}</Button>}
            </>}
        </Section>
      </PlanetShell>
      {drag && <div className="vlt-drop" aria-hidden="true"><span>{t("vlt.drop")}</span></div>}
    </div>
  );
}

type TFn = ReturnType<typeof useT>["t"];
function FileRow({ f, q, snippet, lang, cloudOk, onOpen, t }: { f: VFile; q: string; snippet?: string; lang: "en" | "et"; cloudOk: boolean; onOpen: () => void; t: TFn }) {
  const meta = `${size(f.size, lang)} · ${fileDate(f.mtime, lang)}`;
  const sub = snippet ? <span className="vlt-snip">{highlight(around(snippet, q), q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</span> : meta;
  const sync = !cloudOk ? null : f.sync === "failed" ? <span className="vlt-tag" data-tone="warn" title={f.syncError ?? undefined}>{t("vlt.tag.failed")}</span>
    : f.sync === "pending" ? <span className="vlt-tag">{t("vlt.tag.pending")}</span>
    : f.cloud === false ? <span className="vlt-tag">{t("vlt.tag.local")}</span> : null;
  return <Row onClick={onOpen} title={f.name} sub={sub} trail={sync ?? undefined}
    lead={f.type === "image" ? <img className="vlt-thumb" src={thumbUrl(f, 96)} alt="" width={28} height={28} loading="lazy" decoding="async" /> : <span className="vlt-kind" data-kind={f.type}>{TAG[f.type]}</span>} />;
}

/** The storage map: one thin bar by type, and the same groups as filter chips with their size. Real numbers only. */
function StorageMap({ map, total, group, onGroup }: { map: ReturnType<typeof storageMap>; total: number; group: Group | "all"; onGroup: (g: Group | "all") => void }) {
  const { t, lang } = useT();
  const count = map.reduce((a, g) => a + g.count, 0);
  return (
    <div className="vlt-map">
      <div className="vlt-bar" role="img" aria-label={map.filter((g) => g.count).map((g) => `${t(`vlt.g.${g.group}`)} ${size(g.bytes, lang)}`).join(", ")}>
        {map.filter((g) => g.bytes > 0).map((g) => <i key={g.group} data-g={g.group} data-dim={group !== "all" && group !== g.group ? "" : undefined} style={{ flexGrow: Math.max(g.share, 0.012) }} />)}
      </div>
      <div className="pu-chips" role="group" aria-label={t("vlt.g.label")}>
        <Chip pressed={group === "all"} onClick={() => onGroup("all")}>{t("vlt.g.all")} <span className="pu-num vlt-chip-n">{count}</span></Chip>
        {map.filter((g) => g.count > 0 || group === g.group).map((g) => (
          <Chip key={g.group} pressed={group === g.group} onClick={() => onGroup(group === g.group ? "all" : g.group)} title={`${g.count} · ${size(g.bytes, lang)}`}>
            <span className="vlt-swatch" data-g={g.group} aria-hidden="true" />{t(`vlt.g.${g.group}`)} <span className="pu-num vlt-chip-n">{size(g.bytes, lang)}</span>
          </Chip>))}
      </div>
      <span className="pu-sr">{size(total, lang)}</span>
    </div>
  );
}

function SortButton({ value, labels, onChange, label }: { value: Sort; labels: Record<Sort, string>; onChange: (s: Sort) => void; label: string }) {
  return (
    <label className="vlt-sort">
      <span className="pu-sr">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Sort)}>
        {(Object.keys(labels) as Sort[]).map((k) => <option key={k} value={k}>{labels[k]}</option>)}
      </select>
    </label>
  );
}


function PodcastPicker({ files, busy, onMake, audio }: { files: VFile[]; busy: boolean; onMake: (names: string[]) => void; audio: string }) {
  const { t, lang } = useT();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 6 ? p : [...p, n]));
  return <>
    <p className="vlt-note">{t("vlt.pod.note")}</p>
    {audio && <audio className="vlt-audio" controls src={audio} />}
    {!files.length ? <Empty title={t("vlt.pod.empty")} text={t("vlt.pod.emptyText")} /> : <>
      <ul className="pu-list">{files.slice(0, 40).map((f) => (
        <li key={f.name}><label className="pu-row vlt-pick" data-hover="">
          <input type="checkbox" checked={picked.includes(f.name)} disabled={!picked.includes(f.name) && picked.length >= 6} onChange={() => toggle(f.name)} />
          <span className="pu-row-text"><span className="pu-row-title">{f.name}</span><span className="pu-row-sub">{size(f.size, lang)} · {fileDate(f.mtime, lang)}</span></span>
        </label></li>))}</ul>
      <div className="vlt-sheet-foot"><span className="vlt-note">{t("vlt.pod.picked", { n: picked.length })}</span>
        <Button variant="primary" busy={busy} disabled={!picked.length} onClick={() => onMake(picked)}>{t("vlt.pod.make")}</Button></div>
    </>}
  </>;
}
