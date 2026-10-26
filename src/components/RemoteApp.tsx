"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteCall } from "./RemoteCall";

// /remote: the paired phone's page (roadmap 6.2). Light on purpose: no three.js, polls every 20 s while visible.
// Every call is one remote-pure command with a fresh nonce; the device token rides in an HttpOnly cookie the page can't read.
type Item = { id: string; kind: "clip" | "spend" | "send" | "nego"; title: string; detail: string; seen: string; credits?: number; thumb?: boolean; to?: string; message?: string; strategy?: string };
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
  const [paired, setPaired] = useState<boolean | null>(null);
  const [off, setOff] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [noThumb, setNoThumb] = useState<Record<string, boolean>>({}); // thumbnails that failed to load
  const [habit, setHabit] = useState(""); // ?habit=<id> from a habit nudge: one-tap Done where the phone shows no notification actions
  useEffect(() => { setHabit(new URLSearchParams(location.search).get("habit") ?? ""); }, []);

  const load = useCallback(async () => {
    const r = await send("status").catch(() => null);
    if (!r) return setMsg({ ok: false, text: "Can't reach ORBIT: is the PC on and Tailscale connected?" });
    if (r.status === 401) return setPaired(false);
    if (r.status === 503) { setOff(await errorOf(r)); return setPaired(false); }
    if (!r.ok) return setMsg({ ok: false, text: await errorOf(r) });
    setPaired(true); setStatus(await r.json());
    const a = await send("approval.list").catch(() => null);
    if (a?.ok) setItems(((await a.json()) as { items: Item[] }).items);
  }, []);
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
    } catch { setMsg({ ok: false, text: "Network error" }); }
    setBusy("");
    void load();
  }

  const decide = (it: Item, approve: boolean) => {
    const what = it.kind === "spend" ? `Spend ${it.credits} Higgsfield credits on “${it.title}”?` : it.kind === "send" || (it.kind === "nego" && it.to) ? `Email this exact message to ${it.to}?` : it.kind === "nego" ? `Approve this message to “${it.title}”? You copy and send it yourself.` : `${approve ? "Approve" : "Reject"} “${it.title}”?${approve ? "" : " Its files are deleted."}`;
    if (!confirm(what)) return;
    void act(it.id, () => send(approve ? "approve" : "reject", { id: it.id }, { kind: it.kind, seen: it.seen, ...(it.credits !== undefined ? { credits: it.credits } : {}) }), (j) => j.message ?? "Done");
  };

  const stopAll = () => { // ON only: resuming is done on the PC
    if (!status || status.stop.on || !confirm("Stop all: pause agents, automations and goals now? Resuming is done on the PC.")) return;
    void act("stop", () => send("stopAll", {}, { on: false }), () => "Stop-all is on: ORBIT paused");
  };

  if (paired === null) return <Shell><p className="muted text-sm">Connecting…</p></Shell>;
  if (!paired) return <Shell><Pair off={off} onPaired={() => void load()} /></Shell>;
  const q = status?.queue;
  return (
    <Shell>
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      {habit && (
        <section className="card space-y-2" aria-labelledby="r-habit">
          <h2 id="r-habit" className="text-sm font-semibold">Habit time</h2>
          <button className="btn w-full" style={{ minHeight: 48 }} disabled={!!busy}
            onClick={() => void act("habit", () => send("habit.done", { id: habit }), (j) => { setHabit(""); history.replaceState(null, "", "/remote"); return j.message ?? "Done"; })}>
            {busy === "habit" ? "…" : "Done"}
          </button>
        </section>
      )}

      <section className="card space-y-2" aria-labelledby="r-stop">
        <h2 id="r-stop" className="text-sm font-semibold">Stop-all</h2>
        <p className="muted text-sm">{status?.stop.on ? "ON: ORBIT is paused. Resume it from the PC." : "Off: ORBIT is running."}</p>
        {!status?.stop.on && <button className="btn danger w-full" disabled={!!busy} onClick={stopAll} style={{ minHeight: 48 }}>Stop all</button>}
      </section>

      <section className="space-y-2" aria-labelledby="r-appr">
        <h2 id="r-appr" className="text-sm font-semibold">Waiting for you ({items.length})</h2>
        {!items.length && <p className="muted text-sm">Nothing to approve.</p>}
        {items.map((it) => {
          const blind = it.kind === "clip" && (!it.thumb || noThumb[it.id]); // he can't see it here: review on the PC
          return (
          <article key={it.id} className="card space-y-2">
            <div className="text-sm font-semibold">{it.title}</div>
            <div className="muted text-xs">{it.detail}</div>
            {it.kind === "clip" && (blind ? <p className="muted text-sm">No preview: open on PC to review.</p>
              : <img src={`/api/remote/thumb?id=${it.id}&v=${it.seen}`} alt={`Thumbnail of ${it.title}`} className="w-full rounded-lg" style={{ maxHeight: 360, objectFit: "contain", background: "#000" }} onError={() => setNoThumb((m) => ({ ...m, [it.id]: true }))} />)}
            {it.kind === "spend" && <div className="text-sm">Quote: <b>{it.credits} credits</b></div>}
            {it.kind === "nego" && <div className="text-xs">Plan: {it.strategy}</div>}
            {(it.kind === "send" || it.kind === "nego") && <>
              {it.to && <div className="text-sm">To: <b>{it.to}</b></div>}
              <pre className="field w-full whitespace-pre-wrap text-xs" style={{ fontFamily: "inherit", maxHeight: 260, overflow: "auto" }}>{it.message}</pre>
            </>}
            <div className="flex gap-2">
              <button className="btn flex-1" style={{ minHeight: 44 }} disabled={!!busy || blind} onClick={() => decide(it, true)}>
                {busy === it.id ? "…" : it.kind === "spend" ? `Approve ${it.credits} credits` : it.kind === "send" || (it.kind === "nego" && it.to) ? "Approve & send" : "Approve"}
              </button>
              {it.kind === "clip" && <button className="chip" style={{ minHeight: 44 }} disabled={!!busy} onClick={() => decide(it, false)}>Reject</button>}
            </div>
          </article>
          );
        })}
      </section>

      <section className="card space-y-1" aria-labelledby="r-queue">
        <h2 id="r-queue" className="text-sm font-semibold">Studio queue</h2>
        {q && <p className="muted text-sm">{q.ready} to review · {q.approved} approved, not yet published{q.publishing ? " · uploading now" : ""}{q.story ? " · AI story generating" : ""}</p>}
        {q?.active.length ? q.active.map((j) => (
          <div key={j.id} className="text-sm"><span className="font-semibold">{j.source}</span> <span className="muted">{j.step || j.status} {Math.round(j.progress * 100)}%</span></div>
        )) : <p className="muted text-sm">No jobs running.</p>}
      </section>

      <RemoteCall />
      <Ask />
      <Notify />
    </Shell>
  );
}

/** Web Push (6.3). iOS: only inside the Home Screen app (16.4+), and permission must be asked from a tap. */
function Notify() {
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
      const r = await fetch("/api/remote/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
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
    <section className="card space-y-2" aria-labelledby="r-notify">
      <h2 id="r-notify" className="text-sm font-semibold">Notifications</h2>
      {!supported ? <p className="muted text-sm">On iPhone (iOS 16.4+), open Remote from the Home Screen to turn notifications on.</p>
        : !info ? <p className="muted text-sm">Checking…</p>
        : info.problem ? <p className="muted text-sm">{info.problem}</p>
        : <>
          <p className="muted text-sm">Approvals waiting, Shorts going live, failed jobs and Stop-all. Only a short label, never the content. Quiet 23:00–08:00 except failures.</p>
          {info.on ? <button className="chip" style={{ minHeight: 44 }} disabled={busy} onClick={disable}>Turn off on this phone</button>
            : <button className="btn w-full" style={{ minHeight: 48 }} disabled={busy} onClick={enable}>{busy ? "…" : "Enable notifications"}</button>}
        </>}
      {note && <p className="muted text-sm" role="status">{note}</p>}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 px-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
      <h1 className="text-lg font-semibold tracking-wide" style={{ fontFamily: "var(--font-display)" }}>ORBITAL REMOTE</h1>
      {children}
    </main>
  );
}

function Pair({ off, onPaired }: { off: string; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (off) return <p className="error" role="alert">{off}</p>;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim(), name: /iPhone/.test(navigator.userAgent) ? "iPhone" : "Phone" }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) return onPaired();
    setErr(r ? await errorOf(r) : "Network error");
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <p className="text-sm">On the PC: Profile → <b>Pair phone</b>. Type the 6-digit code here within 2 minutes.</p>
      <p className="muted text-xs">On iPhone, add this page to the Home Screen first and pair from there: the home-screen app keeps its own sign-in.</p>
      <input className="field w-full text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required aria-label="Pairing code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      <button className="btn w-full" style={{ minHeight: 48 }} disabled={busy || code.length !== 6}>{busy ? "Pairing…" : "Pair"}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

function Ask() {
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
        body: JSON.stringify({ cmd: JSON.stringify({ type: "core.ask", nonce: nonce(), text: text.trim() }) }) });
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
          else if (ev.type === "error") setErr(ev.error ?? "CORE failed");
        }
      }
      setText("");
    } catch (e2) {
      if (!ac.current?.signal.aborted) setErr(e2 instanceof Error ? e2.message : "Failed");
    }
    setBusy(false); setStep("");
  }
  return (
    <form onSubmit={ask} className="card space-y-2" aria-labelledby="r-ask">
      <h2 id="r-ask" className="text-sm font-semibold">Ask CORE</h2>
      <textarea className="field h-24 w-full" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything…" aria-label="Question for CORE" />
      <div className="flex gap-2">
        <button className="btn flex-1" style={{ minHeight: 44 }} disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Ask"}</button>
        {busy && <button type="button" className="chip" onClick={() => ac.current?.abort()}>Stop</button>}
      </div>
      {step && <p className="muted text-xs" aria-live="polite">{step}</p>}
      {answer && <div className="whitespace-pre-wrap text-sm" aria-live="polite">{answer}</div>}
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}
