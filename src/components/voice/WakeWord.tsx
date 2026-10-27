"use client";
// Hands-free listener, loaded only once hands-free is on (VoiceControls mounts it); reports useWakeWord's state up.
import { useEffect } from "react";
import { useWakeWord } from "./useWakeWord";
import type { HandsFree } from "./bus";

export type Wake = ReturnType<typeof useWakeWord>;

export default function WakeWord({ mode, paused, lang, onChange }: { mode: HandsFree; paused: boolean; lang: string; onChange: (w: Wake | null) => void }) {
  const w = useWakeWord(mode, paused, lang);
  useEffect(() => { onChange(w); }, [w.state, w.error, w.interim, w.conversation, w.note]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onChange(null), [onChange]); // unmounted (hands-free off): back to "off"
  return null;
}
