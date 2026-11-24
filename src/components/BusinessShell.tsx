"use client";
// BUSINESS planet (design language + MIX look): one calm shell. Main job first: one ask box → CORE does it. Then Needs you
// (follow-ups due, drafts to check, first messages to write: todayQueue, shown once), Working on it (what CORE is finding or
// writing right now), Results (open clients, replies, pilots, € a month) with the pipeline map as the "advanced" layer.
// Clients, Find clients, Money, Insights and Setup open as sheets from the "…" menu.
// Data: ONE GET /api/business shared by the shell and every sheet; an action patches it in place (business-state-pure).
// Nothing is sent from here: Needs you only opens the client card, where the two-click Approve & send lives (AGENTS.md rule 6).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanetShell, Section, Button, Card, Empty, Loading, ErrorState, Sheet, WorkCard, toast, uiSound, type MenuItem } from "@/components/ui";
import { dueFollowups } from "@/lib/business-pure";
import { mapNodes } from "@/lib/business-map-pure";
import { applyAction, bizResults, type BizState } from "@/lib/business-state-pure";
import { todayQueue } from "@/lib/planet-view-pure";
import { fromStages, type Progress } from "@/lib/progress-pure";
import type { Key } from "@/lib/i18n-pure";
import { VOICE_ASK } from "./voice/bus";
import BusinessMap from "./BusinessMap";
import { ClientsView, FindView, InsightsView, MoneyView, SetupView, type Biz } from "./BusinessPanel";
import { useT } from "./i18n";
import "@/app/business-planet.css";

type SheetId = "clients" | "find" | "money" | "insights" | "setup";

async function call(method: "GET" | "POST", body?: object) {
  const res = await fetch("/api/business", { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);
  return json;
}

/** The one shared BUSINESS state: loaded once, patched after each action, fully reloaded only when the server must say. */
function useBusiness() {
  const [st, setSt] = useState<BizState | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState("");
  const stRef = useRef<BizState | null>(null);
  stRef.current = st;
  const reload = useCallback(() => {
    setErr(false);
    call("GET").then((j: BizState) => setSt(j), () => setErr(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const fail = useCallback((msg: string) => { toast({ text: msg, tone: "error" }); uiSound("error"); }, []);
  const act = useCallback(async (key: string, body: object) => {
    setBusy(key);
    try {
      const reply = await call("POST", body);
      const cur = stRef.current, next = cur && applyAction(cur, body as never, reply, new Date().toISOString());
      if (next) setSt(next); else reload();
      return true;
    } catch (e) { fail((e as Error).message); return false; } finally { setBusy(""); }
  }, [reload, fail]);
  return { st, err, busy, setBusy, act, reload, fail };
}

/** Busy key → a "Working on it" card (only what CORE is doing right now, started from this planet). */
function busyWork(busy: string, st: BizState | null, t: (k: Key, v?: Record<string, string | number>) => string, lang: "en" | "et", started: string): Progress[] {
  if (!busy) return [];
  const [kind, id] = busy.split(":");
  const name = st?.prospects.find((p) => p.id === id)?.name ?? id ?? "";
  const job = { draft: "bz.w.draft", followup: "bz.w.followup", research: "bz.w.research", find: "bz.w.find", leads: "bz.w.leads", send: "bz.w.send" }[kind] as Key | undefined;
  if (!job) return [];
  return [fromStages({ id: busy, title: t(job, { name }), stages: [t("bz.w.step")], current: 0, startedAt: started, typicalMs: kind === "leads" ? 5 * 60_000 : 60_000, at: started }, lang, Date.now())];
}

export function BusinessShell({ onClose, focusId = null, onFocus }: { onClose?: () => void; focusId?: string | null; onFocus?: (id: string | null) => void }) {
  const { t, lang } = useT();
  const biz = useBusiness();
  const { st, err, busy, reload } = biz;
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [lit, setLit] = useState("");
  const open = useCallback((s: SheetId) => { uiSound("sheetOpen"); setSheet(s); }, []);
  const close = () => { uiSound("sheetClose"); setSheet(null); setLit(""); onFocus?.(null); };
  const pick = useCallback((id: string) => { setLit(id); open("clients"); }, [open]);
  useEffect(() => { if (focusId && st?.prospects.some((p) => p.id === focusId)) pick(focusId); }, [focusId, !!st]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = !!focusId && !!st && !st.prospects.some((p) => p.id === focusId);

  const loc = lang === "et" ? "et-EE" : "en-GB";
  const euro = useMemo(() => new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }), [loc]);
  const now = useMemo(() => Date.now(), [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const queue = useMemo(() => (st ? todayQueue(st.prospects, now, 5) : []), [st, now]);
  const nodes = useMemo(() => (st ? mapNodes(st.prospects, new Set(dueFollowups(st.prospects, now).map((p) => p.id))) : []), [st, now]);
  const res = st ? bizResults(st) : null;
  const startedAt = useMemo(() => new Date().toISOString(), [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = busyWork(busy, st, t, lang === "et" ? "et" : "en", startedAt);

  const before = useRef(-1);
  useEffect(() => { if (!st) return; if (before.current >= 0 && queue.length > before.current) uiSound("needs"); before.current = queue.length; }, [queue.length, st]);

  const menu: MenuItem[] = [
    { label: t("bz.s.clients"), onSelect: () => open("clients") },
    { label: t("bz.s.find"), onSelect: () => open("find") },
    { label: t("bz.s.money"), onSelect: () => open("money") },
    { label: t("bz.s.insights"), onSelect: () => open("insights") },
    "separator",
    { label: t("bz.s.setup"), onSelect: () => open("setup") },
  ];
  const status = st && res ? t("bz.status", { n: res.open, m: euro.format(res.monthly) }) : t("bz.statusLoading");
  const stage = (s: string) => t(`bz.stage.${s}` as Key);
  const fullBiz: Biz | null = st ? { ...biz, st } : null;

  const body = () => {
    if (!st && err) return <ErrorState title={t("bz.err.title")} text={t("bz.err.text")} retryLabel={t("bz.retry")} onRetry={reload} />;
    if (!st || !res) return <Loading rows={4} label={t("bz.loading")} />;
    return <>
      {err && <p className="biz-note" role="alert">{t("bz.err.stale")} <button className="biz-link" onClick={reload}>{t("bz.retry")}</button></p>}
      {missing && <p className="biz-note" role="status">{t("link.missingClient")}</p>}
      <Section id="biz-needs" title={t("bz.needs")} count={queue.length || undefined}>
        {queue.length ? <ul className="pu-list biz-cards">{queue.map((q) => <Card as="li" key={`${q.kind}:${q.id}`} tone="needs" title={q.name} sub={t(`bizws.q.${q.kind}` as Key)}
          actions={<Button size="sm" variant={q.kind === "send" ? "primary" : "secondary"} onClick={() => pick(q.id)}>{t(q.kind === "send" ? "bz.check" : "common.open")}</Button>} />)}</ul>
          : <Empty title={t("bz.needsNone")} text={t("bz.needsNoneText")} action={<Button size="sm" variant="secondary" onClick={() => open("find")}>{t("bz.s.find")}</Button>} />}
      </Section>
      <Section id="biz-work" title={t("bz.working")} count={work.length || undefined}>
        {work.length ? <ul className="pu-list">{work.map((p) => <WorkCard key={p.id} p={p} onAction={() => {}} />)}</ul>
          : <Empty title={t("bz.workingNone")} text={t("bz.workingNoneText")} />}
      </Section>
      <Section id="biz-results" title={t("bz.results")} action={<Button size="sm" variant="ghost" onClick={() => open("clients")}>{t("bz.seeAll")}</Button>}>
        <div className="biz-trio">
          <Stat label={t("bz.r.open")} value={String(res.open)} sub={t("bz.r.replied", { n: res.replied })} />
          <Stat label={t("bz.r.pilots")} value={String(res.pilots)} sub={t("bz.r.paying", { n: res.paying })} />
          <Stat label={t("bz.r.monthly")} value={euro.format(res.monthly)} sub={t("bz.r.notCash")} />
        </div>
        {nodes.length > 0 ? <BusinessMap nodes={nodes} onPick={pick} label={t("bz.map", { n: nodes.length })} stageName={stage} dueText={t("bz.due")} />
          : <Empty title={t("bz.noClientsTitle")} text={t("bz.noClients")} />}
      </Section>
    </>;
  };

  const title: Record<SheetId, Key> = { clients: "bz.s.clients", find: "bz.s.find", money: "bz.s.money", insights: "bz.s.insights", setup: "bz.s.setup" };
  return (
    <PlanetShell planet="business" title={t("bz.title")} status={status} menu={menu} menuLabel={t("bz.more")} onClose={onClose} closeLabel={t("bz.close")} className="biz-shell"
      ask={{ label: t("bz.ask"), placeholder: t("ph.business.ex1"), sendLabel: t("bz.askSend"), suggestions: [t("ph.business.ex1"), t("ph.business.ex2"), t("ph.business.ex3")],
        onSubmit: (text) => { dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } })); toast({ text: t("bz.asked") }); } }}
      sheet={<Sheet open={!!sheet} title={sheet ? t(title[sheet]) : ""} onClose={close} closeLabel={t("bz.close")}>
        {sheet && (!fullBiz ? (err ? <ErrorState title={t("bz.err.title")} text={t("bz.err.text")} retryLabel={t("bz.retry")} onRetry={reload} /> : <Loading label={t("bz.loading")} />)
          : sheet === "clients" ? <ClientsView biz={fullBiz} lit={lit} />
          : sheet === "find" ? <FindView biz={fullBiz} />
          : sheet === "money" ? <MoneyView biz={fullBiz} onClient={pick} />
          : sheet === "insights" ? <InsightsView biz={fullBiz} />
          : <SetupView />)}
      </Sheet>}>
      {body()}
    </PlanetShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="biz-stat"><span className="biz-stat-label">{label}</span><span className="biz-stat-value pu-num">{value}</span><span className="biz-stat-sub">{sub}</span></div>;
}
