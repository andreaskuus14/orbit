"use client";
import { useEffect, useRef, useState } from "react";
import { LATER_KEY, briefSpeech, markLater, speechParts, waitingSpeech, type CarItem } from "@/lib/car-mode-pure";
import { CAR_TALK } from "./RemoteCall";
import { useDialogFocus } from "./useDialogFocus";

type BriefReply = { off?: boolean; greeting?: string; spoken?: string } | null;

/** Saved "review later" ids (per phone; a convenience, not a record). */
export function readLater(): string[] {
  try { const v = JSON.parse(localStorage.getItem(LATER_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

// Car mode: for driving or walking. Always dark, the screen stays on, three huge buttons, one line of big text, nothing to scroll.
// Talk starts the normal ORBIT call (car flag: no approvals by voice). Brief and "what's waiting" are read aloud on the phone.
export function RemoteCar({ items, getBrief, onLater, onExit }: { items: CarItem[]; getBrief: () => Promise<BriefReply>; onLater: (ids: string[]) => void; onExit: () => void }) {
  const [line, setLine] = useState("Car mode");
  const [speaking, setSpeaking] = useState(false);
  const brief = useRef<Promise<BriefReply> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, true, onExit);

  useEffect(() => {
    brief.current = getBrief().catch(() => null); // fetched ahead so the tap can speak at once
    let lock: { release(): Promise<void> } | null = null, gone = false;
    const wake = async () => {
      if (gone || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      try { lock = await navigator.wakeLock.request("screen"); if (gone) void lock.release(); } catch { /* not allowed: the screen may dim */ }
    };
    void wake();
    document.addEventListener("visibilitychange", wake); // iOS drops the lock when the app is backgrounded
    return () => { gone = true; document.removeEventListener("visibilitychange", wake); void lock?.release().catch(() => {}); window.speechSynthesis?.cancel(); };
  }, [getBrief]);

  /** Speak sentence by sentence, showing the current one in big type. append: queue after what's being said. */
  function say(text: string, append = false) {
    const s = window.speechSynthesis;
    if (!s) return setLine(text);
    if (!append) s.cancel();
    const parts = speechParts(text);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.onstart = () => { setLine(p); setSpeaking(true); };
      if (i === parts.length - 1) u.onend = u.onerror = () => setSpeaking(false);
      s.speak(u);
    });
  }

  async function readBrief() {
    say("Your brief."); // said inside the tap: iOS only starts speech from a user gesture
    brief.current ??= getBrief().catch(() => null);
    say(briefSpeech(await brief.current), true);
    brief.current = getBrief().catch(() => null); // fresh for the next tap
  }

  function readWaiting() {
    const w = waitingSpeech(items);
    const next = markLater(readLater(), w.ids, items.map((i) => i.id));
    try { localStorage.setItem(LATER_KEY, JSON.stringify(next)); } catch { /* private mode: the tag just won't show */ }
    onLater(next);
    say(w.text);
  }

  function talk() {
    window.speechSynthesis?.cancel(); setSpeaking(false);
    dispatchEvent(new Event(CAR_TALK)); // synchronous: RemoteCall opens the mic inside this tap
  }

  const big = { borderRadius: 28, fontSize: 32, fontWeight: 700, border: "2px solid #333", background: "#111", color: "#fff" } as const;
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Car mode" className="fixed inset-0 z-[90] flex flex-col gap-3 px-4"
      style={{ background: "#000", color: "#fff", colorScheme: "dark", paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <p aria-live="polite" className="overflow-hidden text-center font-semibold" style={{ fontSize: 28, lineHeight: 1.25, height: "3.75em" }}>{line}</p>
      <button onClick={talk} style={{ ...big, flex: 2, fontSize: 64, background: "var(--cyan, #22d3ee)", color: "#000", border: "none" }}>Talk</button>
      <div className="grid grid-cols-2 gap-3" style={{ flex: 1 }}>
        <button onClick={() => void readBrief()} style={big}>Brief</button>
        <button onClick={readWaiting} style={big} aria-label={`Read what's waiting: ${items.length}`}>Waiting{items.length ? ` ${items.length}` : ""}</button>
      </div>
      <div className="grid grid-cols-2 gap-3" style={{ minHeight: 88 }}>
        <button onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); setLine("Car mode"); }} disabled={!speaking} style={{ ...big, fontSize: 26, opacity: speaking ? 1 : 0.4 }}>Quiet</button>
        <button onClick={onExit} style={{ ...big, fontSize: 26 }}>Exit</button>
      </div>
    </div>
  );
}
