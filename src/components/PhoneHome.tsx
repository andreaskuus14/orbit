"use client";
// /m: ORBIT's home on the phone, in the planet look (design-language.md): one ask box (to CORE), then Needs you → Working on it →
// the latest briefing with pictures → quick links. Reads only; every action opens where its own Approve lives (/remote or full
// ORBIT). Data is fetched live from the laptop each time and never stored on the phone (the service worker caches the shell only).
import { useCallback, useEffect, useState } from "react";
import { Ask, Button, Card, Empty, ErrorState, Loading, Row, Section, WorkCard, IconChevron } from "./ui";
import { fromTask, sortProgress, type Progress } from "@/lib/progress-pure";
import type { Need } from "@/lib/needs-you-pure";
import { parseBriefing, type Cite } from "@/lib/briefing-view-pure";
import { putAsk, needHref, PHONE_LINKS, topStories } from "@/lib/phone-pwa-pure";
import { Thumb } from "./IntelRich";
import { useT } from "./i18n";

type InstallEvent = Event & { prompt: () => Promise<void> };
type Task = Parameters<typeof fromTask>[0];
type Brief = { id: string; title: string; content: string; citations: Cite[]; created_at: string };
type Load<T> = T | null | "error";

const RUNNING = new Set(["running", "awaiting_approval", "queued"]);

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (r.status === 503) throw new Error("offline");
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

export function PhoneHome() {
  const { t, lang } = useT();
  const [needs, setNeeds] = useState<Load<Need[]>>(null);
  const [work, setWork] = useState<Load<Progress[]>>(null);
  const [brief, setBrief] = useState<Load<Brief | undefined>>(null);
  const [offline, setOffline] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  const load = useCallback(() => {
    const miss = (e: unknown) => { if (e instanceof Error && e.message === "offline") setOffline(true); return "error" as const; };
    void get<{ items?: Need[] }>(`/api/needs-you?lang=${lang}`).then((j) => { setOffline(false); setNeeds(j.items ?? []); }, (e) => setNeeds(miss(e)));
    void get<{ tasks?: Task[] }>("/api/tasks?lite=1").then((j) => {
      const rows = (j.tasks ?? []).filter((x) => RUNNING.has(x.status));
      setWork(sortProgress(rows.map((x) => fromTask(x, lang, { nowMs: Date.now() }))).slice(0, 5));
    }, (e) => setWork(miss(e)));
    void get<{ briefings?: Brief[] }>("/api/briefings").then((j) => setBrief(j.briefings?.[0]), (e) => setBrief(miss(e)));
  }, [lang]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/m/sw.js", { scope: "/m" }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const net = () => { const off = !navigator.onLine; setOffline(off); if (!off) load(); };
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("online", net); addEventListener("offline", net);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", vis);
    load();
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { removeEventListener("beforeinstallprompt", onPrompt); removeEventListener("online", net); removeEventListener("offline", net);
      document.removeEventListener("visibilitychange", vis); clearInterval(poll); };
  }, [load]);

  const go = (href: string) => { location.href = href; };
  const stories = brief && brief !== "error" ? topStories(parseBriefing(brief.content).sections.flatMap((s) => s.stories), brief.citations) : [];
  const needCount = Array.isArray(needs) ? needs.reduce((s, n) => s + (n.group?.length ?? 1), 0) : 0;

  return (
    <main className="pu pu-shell m-app" data-planet="core" aria-label="ORBIT">
      <header className="pu-head">
        <span className="pu-mark" aria-hidden="true" />
        <div className="pu-head-text">
          <h1 className="pu-title">ORBIT</h1>
          <p className="pu-status" role="status">{offline ? t("m.offline") : needCount ? t("m.status", { n: needCount }) : t("m.statusNone")}</p>
        </div>
        {install && <div className="pu-head-actions"><Button size="sm" onClick={() => { void install.prompt(); setInstall(null); }}>{t("chat.install")}</Button></div>}
      </header>
      <div className="pu-body">
        {offline && <Card tone="error" title={t("m.offTitle")} sub={t("m.offText")} actions={<Button onClick={load}>{t("m.retry")}</Button>} />}
        <Ask label={t("m.askLabel")} placeholder={t("m.askHint")} sendLabel={t("m.send")} onSubmit={(q) => { const h = putAsk(sessionStorage, q); if (h) go(h); }}
          suggestions={[t("m.ex1"), t("m.ex2")]} />

        <Section id="m-needs" title={t("needs.title")} count={needCount || undefined}>
          {needs === null ? <Loading rows={2} label={t("needs.loading")} />
            : needs === "error" ? <ErrorState title={t("m.loadFail")} retryLabel={t("m.retry")} onRetry={load} />
            : !needs.length ? <Empty title={t("m.needsNone")} text={t("m.needsNoneText")} />
            : <ul className="m-list">{needs.slice(0, 5).map((n) => (
              <Card as="li" key={n.ref} tone="needs" title={n.title} sub={n.detail ?? t(`needs.ask.${n.cause}`)}
                actions={<Button variant="primary" onClick={() => go(needHref(n.act.open, n.remote))}>{n.remote ? t("m.check") : t("common.open")}</Button>} />))}</ul>}
        </Section>

        <Section id="m-work" title={t("ph.working")} count={Array.isArray(work) && work.length ? work.length : undefined}>
          {work === null ? <Loading rows={2} label={t("needs.loading")} />
            : work === "error" ? <ErrorState title={t("m.loadFail")} retryLabel={t("m.retry")} onRetry={load} />
            : !work.length ? <Empty title={t("m.workNone")} />
            : <ul className="m-list">{work.map((p) => <WorkCard key={p.id} p={p} onAction={(a) => go(a.open.startsWith("#") ? "/" + a.open : a.open)} />)}</ul>}
        </Section>

        <Section id="m-brief" title={t("m.brief")} action={<Button variant="ghost" size="sm" onClick={() => go("/#o=intelligence")}>{t("m.seeAll")}</Button>}>
          {brief === null ? <Loading rows={3} label={t("needs.loading")} />
            : brief === "error" ? <ErrorState title={t("m.loadFail")} retryLabel={t("m.retry")} onRetry={load} />
            : !stories.length ? <Empty title={t("m.briefNone")} />
            : <ul className="m-list">{stories.map((s, i) => (
              <li key={i}><a className="m-story" href={s.url ?? "/#o=intelligence"} target={s.url ? "_blank" : undefined} rel="noopener noreferrer">
                <Thumb url={s.url ?? undefined} source={s.source} size={i === 0 ? "lead" : "sm"} className="m-thumb" />
                <span className="m-story-text"><span className="pu-row-title">{s.title}</span>{s.source && <span className="pu-row-sub">{s.source}</span>}</span>
              </a></li>))}</ul>}
        </Section>

        <Section id="m-links" title={t("m.links")}>
          <div className="m-links">{PHONE_LINKS.map((l) => <Row key={l.href} title={t(l.key as "m.link.chat")} trail={<IconChevron />} onClick={() => go(l.href)} />)}</div>
        </Section>
      </div>
    </main>
  );
}
