"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteCall } from "./RemoteCall";
import { NeedCard, RemoteGalaxy, type Item } from "./RemoteHome";
import { biggestFirst, headline } from "@/lib/remote-ui-pure";
import { RemoteCar, readLater } from "./RemoteCar";
import { VoiceMemo } from "./VoiceMemo";
import { getLang, LangSwitch, useT } from "./i18n";
import type { PhoneNight } from "@/lib/remote-web-pure";

// /remote: the paired phone's page (roadmap 6.2). Light on purpose: no three.js, polls every 20 s while visible.
// Every call is one remote-pure command with a fresh nonce; the device token rides in an HttpOnly cookie the page can't read.
type Status = { stop: { on: boolean; at: string }; queue: { active: { id: string; source: string; status: string; step: string; progress: number }[]; ready: number; approved: number; publishing: string | null; story: string | null } };

const nonce = () => crypto.randomUUID();
function send(type: string, fields: object = {}, echo?: object, stream = false) {
  return fetch(`/api/remote${stream ? "?stream=1" : ""}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: JSON.stringify({ type, nonce: nonce(), ...fields }), ...(echo ? { echo } : {}) }),
  });
}
const errorOf = async (r: Response) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`;

export function RemoteApp() {
  const { t, lang } = useT();
  const [paired, setPaired] = useState<boolean | null>(null);
  const [off, setOff] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [noThumb, setNoThumb] = useState<Record<string, boolean>>({}); // thumbnails that failed to load
  const [habit, setHabit] = useState(""); // ?habit=<id> from a habit nudge: one-tap Done where the phone shows no notification actions
  useEffect(() => { setHabit(new URLSearchParams(location.search).get("habit") ?? ""); }, []);
  const [car, setCar] = useState(false);
  const [later, setLater] = useState<string[]>([]); // read aloud in car mode: approve on screen
  useEffect(() => setLater(readLater()), []);
  const getBrief = useCallback(async () => { const r = await send("brief"); return r.ok ? ((await r.json()) as { off?: boolean; greeting?: string; spoken?: string }) : null; }, []);

  const load = useCallback(async () => {
    const r = await send("status").catch(() => null);
    if (!r) return setMsg({ ok: false, text: t("remote.unreachable") });
    if (r.status === 401) return setPaired(false);
    if (r.status === 503) { setOff(await errorOf(r)); return setPaired(false); }
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    setPaired(true); setStatus(await r.json());
    const a = await send("approval.list").catch(() => null);
    if (a?.ok) setItems(((await a.json()) as { items: Item[] }).items);
  }, [t]);
  useEffect(() => {
    void load();
    const h = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    const vis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  async function act(key: string, run: () => Promise<Response>, ok: (j: { message?: string }) => string) {
    setBusy(key); setMsg(null);
    try {
      const r = await run();
      setMsg(r.ok ? { ok: true, text: ok(await r.json()) } : { ok: false, text: await errorOf(r) });
    } catch { setMsg({ ok: false, text: t("remote.network") }); }
    setBusy("");
    void load();
  }

  const decide = (it: Item, approve: boolean) => {
    const what = it.kind === "spend" ? t("remote.confirmSpend", { n: it.credits ?? 0, title: it.title }) : it.kind === "send" || ((it.kind === "nego" || it.kind === "invoice") && it.to) ? t("remote.confirmSend", { to: it.to ?? "" }) : it.kind === "nego" || it.kind === "invoice" ? t("remote.confirmNego", { title: (it.kind === "invoice" ? it.buyer : it.title) ?? "" }) : t(approve ? "remote.confirmApprove" : "remote.confirmReject", { title: it.title });
    if (!confirm(what)) return;
    void act(it.id, () => send(approve ? "approve" : "reject", { id: it.id }, { kind: it.kind, seen: it.seen, ...(it.credits !== undefined ? { credits: it.credits } : {}) }), (j) => j.message ?? t("remote.done"));
  };

  const stopAll = () => { // ON only: resuming is done on the PC
    if (!status || status.stop.on || !confirm(t("remote.stopConfirm"))) return;
    void act("stop", () => send("stopAll", {}, { on: false }), () => t("remote.stopped"));
  };

  if (paired === null) return <Shell><p className="muted text-sm">{t("remote.connecting")}</p></Shell>;
  if (!paired) return <Shell><Pair off={off} onPaired={() => void load()} /></Shell>;
  const q = status?.queue;
  const paused = !!status?.stop.on;
  return (
    <Shell>
      <RemoteGalaxy need={items.length} jobs={q?.active.length ?? 0} paused={paused} />
      <button className="btn w-full text-lg" style={{ minHeight: 56 }} onClick={() => setCar(true)}>Car mode</button>
      {car && <RemoteCar items={items} getBrief={getBrief} onLater={setLater} onExit={() => setCar(false)} />}

      {habit && (
        <section className="card space-y-2" aria-labelledby="r-habit">
          <h2 id="r-habit" className="text-sm font-semibold">{t("habit.time")}</h2>
          <button className="btn w-full" style={{ minHeight: 48 }} disabled={!!busy}
            onClick={() => void act("habit", () => send("habit.done", { id: habit }), (j) => { setHabit(""); history.replaceState(null, "", "/remote"); return j.message ?? t("remote.done"); })}>
            {busy === "habit" ? "…" : t("remote.done")}
          </button>
        </section>
      )}

      <section className="rm-hero" aria-labelledby="r-stop">
        <p className="rm-status" style={{ color: paused ? "var(--rose)" : items.length ? "var(--amber)" : "var(--ink)" }} aria-live="polite">{headline(items.length, paused, lang)}</p>
        <div className="flex items-center justify-between gap-3">
          <h2 id="r-stop" className="muted text-sm">{t(paused ? "remote.stopOn" : "remote.stopOff")}</h2>
          {!paused && <button className="btn danger" disabled={!!busy} onClick={stopAll} style={{ minHeight: 44, minWidth: 104 }}>{t("remote.stopButton")}</button>}
        </div>
      </section>

      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <section className="space-y-3" aria-labelledby="r-appr">
        <h2 id="r-appr" className="rm-label">{t("remote.waiting", { n: items.length })}</h2>
        {!items.length && <p className="muted text-sm">{t("remote.nothing")}</p>}
        {biggestFirst(items).map((it) => (
          <NeedCard key={it.id} it={it} busy={busy} later={later.includes(it.id)} blind={it.kind === "clip" && (!it.thumb || !!noThumb[it.id])} // he can't see it here: review on the PC
            onThumbError={() => setNoThumb((m) => ({ ...m, [it.id]: true }))} decide={decide} />
        ))}
      </section>

      <Night />
      <section className="rm-sec" aria-labelledby="r-queue">
        <h2 id="r-queue" className="rm-label">{t("remote.queue")}</h2>
        {q && <p className="muted text-sm">{t("remote.queueLine", { ready: q.ready, approved: q.approved })}{q.publishing ? t("remote.uploading") : ""}{q.story ? t("remote.story") : ""}</p>}
        {q?.active.length ? q.active.map((j) => (
          <div key={j.id} className="text-sm"><span className="font-semibold">{j.source}</span> <span className="muted">{j.step || j.status} {Math.round(j.progress * 100)}%</span></div>
        )) : <p className="muted text-sm">{t("remote.noJobs")}</p>}
      </section>

      <Place />
      <VoiceMemo />
      <RemoteCall />
      <Ask />
      <Notify />
      <LangSwitch />
    </Shell>
  );
}

/** Last night's report: titles and counts only (the server shapes it, see nightForPhone). Hidden when the night did nothing. */
function Night() {
  const { t } = useT();
  const [n, setN] = useState<PhoneNight>(null);
  useEffect(() => { void send("night").then((r) => (r.ok ? r.json() : null)).then((j: { night?: PhoneNight } | null) => setN(j?.night ?? null)).catch(() => {}); }, []);
  if (!n) return null;
  const rows = [...n.approvals.map((x) => ["approval", x] as const), ...n.done.map((x) => ["done", x] as const), ...n.failed.map((x) => ["failed", x] as const)];
  return (
    <section className="rm-sec" aria-labelledby="r-night">
      <h2 id="r-night" className="rm-label">{t("remote.night")}</h2>
      <p className="muted text-sm">{t("remote.nightLine", n.counts)}{n.running ? t("remote.nightRunning") : ""}{n.stopped ? ` · ${n.stopped}` : ""}</p>
      {!!rows.length && <ul className="space-y-1 text-sm">{rows.map(([k, title], i) => <li key={i}><span className="muted">{t(`remote.nightTag.${k}`)}:</span> {title}</li>)}</ul>}
    </section>
  );
}

/** Location-aware brief: shown only when he switched it on in Profile on the PC. One rough point per tap, nothing in the background. */
function Place() {
  const [on, setOn] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/remote/place").then((r) => (r.ok ? r.json() : null)).then((j) => setOn(!!j?.on)).catch(() => {}); }, []);
  if (!on) return null;
  function update() {
    if (!("geolocation" in navigator)) return setNote("This browser can't share location.");
    setBusy(true); setNote("");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const round = (v: number) => Math.round(v * 100) / 100; // ~1 km before it leaves the phone
      const r = await fetch("/api/remote/place", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) }) }).catch(() => null);
      const j = r && (await r.json().catch(() => null));
      setNote(r?.ok ? (j?.near ? `Near ${j.near}.` : "Updated: not near a saved place.") : j?.error ?? "Network error");
      setBusy(false);
    }, (e) => { setNote(e.code === e.PERMISSION_DENIED ? "Location is blocked: allow it for Remote in Settings → Privacy → Location Services." : "Couldn't get a location."); setBusy(false); },
    { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 15_000 });
  }
  return (
    <section className="rm-sec" aria-labelledby="r-place">
      <h2 id="r-place" className="rm-label">Place</h2>
      <p className="muted text-sm">Sends a rough location (about 1 km) to your PC for the morning brief. Only when you tap; the PC keeps just the latest one.</p>
      <button className="btn w-full" style={{ minHeight: 44 }} disabled={busy} onClick={update}>{busy ? "…" : "Update place"}</button>
      {note && <p className="muted text-sm" role="status">{note}</p>}
    </section>
  );
}

/** Web Push (6.3). iOS: only inside the Home Screen app (16.4+), and permission must be asked from a tap. */
function Notify() {
  const { t } = useT();
  const [info, setInfo] = useState<{ problem: string; publicKey: string | null; on: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true); // checked after mount: the server render can't know
  useEffect(() => {
    if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) return setSupported(false);
    void navigator.serviceWorker.register("/remote/sw.js", { scope: "/remote" }).catch(() => {});
    void fetch("/api/remote/push").then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, []);
  async function enable() {
    setBusy(true); setNote("");
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked: allow them for Remote in Settings → Notifications.");
      const reg = await navigator.serviceWorker.register("/remote/sw.js", { scope: "/remote" });
      await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(info!.publicKey!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      await (await reg.pushManager.getSubscription())?.unsubscribe(); // fresh each time: an old one may be tied to a previous key pair
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const r = await fetch("/api/remote/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sub.toJSON(), lang: getLang() }) });
      if (!r.ok) throw new Error(await errorOf(r));
      setInfo({ ...info!, on: true });
      setNote(((await r.json()) as { sent?: boolean }).sent ? "On: a test notification is on its way." : "Saved, but the test notification didn't go through: check ORBIT's log on the PC.");
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn't turn notifications on"); }
    setBusy(false);
  }
  async function disable() {
    setBusy(true); setNote("");
    await fetch("/api/remote/push", { method: "DELETE" }).catch(() => null);
    await (await navigator.serviceWorker.getRegistration("/remote"))?.pushManager.getSubscription().then((s) => s?.unsubscribe()).catch(() => {});
    setInfo(info && { ...info, on: false }); setBusy(false);
  }
  return (
    <section className="rm-sec" aria-labelledby="r-notify">
      <h2 id="r-notify" className="rm-label">{t("remote.notify")}</h2>
      {!supported ? <p className="muted text-sm">{t("remote.notifyIos")}</p>
        : !info ? <p className="muted text-sm">{t("remote.checking")}</p>
        : info.problem ? <p className="muted text-sm">{info.problem}</p>
        : <>
          <p className="muted text-sm">{t("remote.notifyAbout")}</p>
          {info.on ? <button className="chip" style={{ minHeight: 44 }} disabled={busy} onClick={disable}>{t("remote.notifyOff")}</button>
            : <button className="btn w-full" style={{ minHeight: 48 }} disabled={busy} onClick={enable}>{busy ? "…" : t("remote.notifyOn")}</button>}
        </>}
      {note && <p className="muted text-sm" role="status">{note}</p>}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <main className="rm-shell mx-auto max-w-lg space-y-4">
      <h1 className="rm-title">{t("remote.title")}</h1>
      {children}
    </main>
  );
}

/** Also used by /screen (screen: pairs as a read-only screen). */
export function Pair({ off, onPaired, screen }: { off: string; onPaired: () => void; screen?: boolean }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (off) return <p className="error" role="alert">{off}</p>;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim(), ...(screen ? { name: "Screen", type: "screen" } : { name: /iPhone/.test(navigator.userAgent) ? "iPhone" : "Phone" }) }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) return onPaired();
    setErr(r ? await errorOf(r) : "Network error");
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <p className="text-sm">On the PC: Profile → <b>Pair phone</b>. Type the 6-digit code here within 2 minutes.</p>
      <p className="muted text-xs">{screen ? "This pairs a read-only screen: it can look, never approve, stop or ask." : "On iPhone, add this page to the Home Screen first and pair from there: the home-screen app keeps its own sign-in."}</p>
      <input className="field w-full text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required aria-label="Pairing code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      <button className="btn w-full" style={{ minHeight: 48 }} disabled={busy || code.length !== 6}>{busy ? "Pairing…" : "Pair"}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

function Ask() {
  const { t } = useT();
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController | null>(null);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setAnswer(""); setErr(""); setStep("");
    ac.current = new AbortController();
    try {
      const r = await fetch("/api/remote?stream=1", { method: "POST", headers: { "content-type": "application/json" }, signal: ac.current.signal,
        body: JSON.stringify({ cmd: JSON.stringify({ type: "core.ask", nonce: nonce(), text: text.trim(), ...(getLang() === "et" ? { lang: "et" } : {}) }) }) });
      if (!r.ok || !r.body) throw new Error(await errorOf(r));
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l) as { type: string; text?: string; label?: string; answer?: string; error?: string };
          if (ev.type === "delta") setAnswer((a) => a + ev.text);
          else if (ev.type === "reset") setAnswer("");
          else if (ev.type === "step") setStep(ev.label ?? "");
          else if (ev.type === "done") { setAnswer(ev.answer ?? ""); setStep(""); }
          else if (ev.type === "error") setErr(ev.error ?? t("remote.coreFailed"));
        }
      }
      setText("");
    } catch (e2) {
      if (!ac.current?.signal.aborted) setErr(e2 instanceof Error ? e2.message : t("remote.failed"));
    }
    setBusy(false); setStep("");
  }
  return (
    <form onSubmit={ask} className="rm-sec" aria-labelledby="r-ask">
      <h2 id="r-ask" className="rm-label">{t("remote.ask")}</h2>
      <textarea className="field h-24 w-full" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("remote.askPlaceholder")} aria-label={t("remote.askAria")} />
      <div className="flex gap-2">
        <button className="btn flex-1" style={{ minHeight: 44 }} disabled={busy || !text.trim()}>{busy ? t("remote.thinking") : t("remote.askButton")}</button>
        {busy && <button type="button" className="chip" style={{ minHeight: 44 }} onClick={() => ac.current?.abort()}>{t("remote.askStop")}</button>}
      </div>
      {step && <p className="muted text-xs" aria-live="polite">{step}</p>}
      {answer && <div className="whitespace-pre-wrap text-sm" aria-live="polite">{answer}</div>}
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}
