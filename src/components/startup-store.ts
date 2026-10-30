// Which startup surfaces want the screen right now (startup-pure decides whose turn it is). Shared by Herald, MorningCard and What's new.
import { useEffect, useRef, useState } from "react";
import { OPENED_KEY, STARTUP_EVENT, isTurn, type Ready, type Surface } from "@/lib/startup-pure";
import { localDay } from "@/lib/morning-pure";

const wanting = new Set<Surface>();
export const wantingNow = (): Surface[] => [...wanting];
export function want(s: Surface, on: boolean) {
  if (on === wanting.has(s)) return;
  if (on) wanting.add(s); else wanting.delete(s);
  dispatchEvent(new CustomEvent(STARTUP_EVENT, { detail: wantingNow() }));
}
export function useWanting() {
  const [list, setList] = useState<Surface[]>(wantingNow);
  useEffect(() => {
    const f = () => setList(wantingNow());
    addEventListener(STARTUP_EVENT, f); f();
    return () => removeEventListener(STARTUP_EVENT, f);
  }, []);
  return list;
}
/** Registers `s` while `on`; true when no higher-priority surface wants the screen. */
export function useTurn(s: Surface, on: boolean) {
  const list = useWanting();
  useEffect(() => { want(s, on); return () => want(s, false); }, [s, on]);
  return isTurn(s, list);
}

// Quiet open (startup-pure pillOf): surfaces that are ready but wait in the header pill until he opens them.
export const READY_EVENT = "orbit:startup-ready", OPEN_EVENT = "orbit:startup-open"; // OPEN_EVENT detail: Ready to show now
const ready = new Set<Ready>();
export function setReady(r: Ready, on: boolean) {
  if (on === ready.has(r)) return;
  if (on) ready.add(r); else ready.delete(r);
  dispatchEvent(new Event(READY_EVENT));
}
export function useReady() {
  const [list, setList] = useState<Ready[]>([]);
  useEffect(() => {
    const f = () => setList([...ready]);
    addEventListener(READY_EVENT, f); f();
    return () => removeEventListener(READY_EVENT, f);
  }, []);
  return list;
}
/** Calls `f` when the pill asks to open `r`. */
export function useOpenRequest(r: Ready, f: () => void) {
  const ref = useRef(f);
  ref.current = f;
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent<Ready>).detail === r) ref.current(); };
    addEventListener(OPEN_EVENT, h);
    return () => removeEventListener(OPEN_EVENT, h);
  }, [r]);
}
let opened: boolean | null = null;
/** true when ORBIT was already opened earlier today (this page load stamps today once). */
export function openedToday() {
  if (opened === null) {
    const day = localDay(new Date());
    try { opened = localStorage.getItem(OPENED_KEY) === day; localStorage.setItem(OPENED_KEY, day); } catch { opened = false; }
  }
  return opened;
}
