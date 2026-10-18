"use client";
// Calm HAL-style eye on the home screen. Glows with the voice level (read per frame from the bus, no re-renders), drifts toward
// the mouse, greys out when ORBIT is muted or Stop-all is on. Click = the 🔇 button in VoiceControls (flip `speak`).
import { useEffect, useRef, useState } from "react";
import { loadVoiceSettings, saveVoiceSettings, voiceLevel, type VoiceSettings } from "./voice/bus";

export function HalEye() {
  const ref = useRef<HTMLButtonElement>(null);
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    setVoice(loadVoiceSettings());
    const on = (e: Event) => setVoice((e as CustomEvent<VoiceSettings>).detail ?? loadVoiceSettings());
    addEventListener("orbit:voice-settings", on);
    return () => removeEventListener("orbit:voice-settings", on);
  }, []);

  // shortcut: polls /api/stop-all like StopAll.tsx does (no shared store yet); move to an event if StopAll ever broadcasts its state.
  useEffect(() => {
    const load = () => fetch("/api/stop-all").then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) setStopped(!!s.stop?.on); }).catch(() => {});
    load();
    const h = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const aim = { x: 0, y: 0 }, at = { x: 0, y: 0 };
    let glow = 0, raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 400) * 5; // at most 5px off-centre
      aim.x = (dx / d) * k; aim.y = (dy / d) * k;
    };
    const tick = () => {
      glow += (Math.min(1, Math.max(voiceLevel.mic, voiceLevel.speak) * 2.5) - glow) * 0.15;
      el.style.setProperty("--glow", glow.toFixed(3));
      if (!still) { at.x += (aim.x - at.x) * 0.06; at.y += (aim.y - at.y) * 0.06; el.style.setProperty("--ex", `${at.x.toFixed(2)}px`); el.style.setProperty("--ey", `${at.y.toFixed(2)}px`); }
      raf = requestAnimationFrame(tick);
    };
    if (!still) addEventListener("pointermove", move);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); removeEventListener("pointermove", move); };
  }, []);

  const muted = !voice?.speak, dim = muted || stopped;
  return (
    <button ref={ref} type="button" className={`hal-eye absolute bottom-20 right-4 z-20 lg:bottom-5${dim ? " dim" : ""}`} disabled={!voice}
      onClick={() => voice && saveVoiceSettings({ ...voice, speak: !voice.speak })} aria-pressed={!muted}
      aria-label={muted ? "Unmute ORBIT's voice" : "Mute ORBIT's voice"}
      title={`${muted ? "ORBIT is muted — click to hear answers" : "ORBIT speaks answers — click to mute"}${stopped ? " · Stop-all is on" : ""}`}>
      <style>{`
.hal-eye { --glow: 0; width: 44px; height: 44px; border-radius: 50%; border: 2px solid #3f3f46; background: radial-gradient(circle, #18181b 55%, #09090b);
  box-shadow: 0 0 calc(10px + var(--glow) * 22px) rgba(255, 80, 30, calc(0.35 + var(--glow) * 0.5)); transition: filter 0.4s, box-shadow 0.2s; cursor: pointer; }
.hal-eye i { display: block; width: 16px; height: 16px; margin: auto; border-radius: 50%; transform: translate(var(--ex, 0), var(--ey, 0)) scale(calc(1 + var(--glow) * 0.25));
  background: radial-gradient(circle at 45% 40%, #fde68a 0 12%, #ff5a1f 30%, #b91c1c 65%, transparent 72%); filter: brightness(calc(0.85 + var(--glow) * 0.6));
  animation: hal-breathe 4s ease-in-out infinite; }
.hal-eye:focus-visible { outline: 2px solid var(--cyan, #22d3ee); outline-offset: 3px; }
.hal-eye.dim { filter: grayscale(1) brightness(0.6); box-shadow: none; }
.hal-eye.dim i { animation: none; }
@keyframes hal-breathe { 50% { opacity: 0.75; } }
@media (prefers-reduced-motion: reduce) { .hal-eye i { animation: none; transform: none; } }
`}</style>
      <i aria-hidden="true" />
    </button>
  );
}
