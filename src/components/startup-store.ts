// Which startup surfaces want the screen right now (startup-pure decides whose turn it is). Shared by Herald, MorningCard and What's new.
import { useEffect, useState } from "react";
import { STARTUP_EVENT, isTurn, type Surface } from "@/lib/startup-pure";

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
