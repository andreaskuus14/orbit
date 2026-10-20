// Client persistence with an in-memory fallback when storage is blocked/full.
import { INTERRUPTION_CHANGED, INTERRUPTION_KEY, parseJudgment, emptyJudgment, type JudgmentState } from "@/lib/interruption-pure";
let memory = emptyJudgment();
let storageFailed = false;
export function loadJudgment(): JudgmentState {
  try { if (!storageFailed) memory = parseJudgment(localStorage.getItem(INTERRUPTION_KEY), Date.now()); } catch { storageFailed = true; }
  return memory;
}
export function saveJudgment(s: JudgmentState) {
  memory = s;
  try { localStorage.setItem(INTERRUPTION_KEY, JSON.stringify(s)); storageFailed = false; } catch { storageFailed = true; }
  dispatchEvent(new Event(INTERRUPTION_CHANGED));
}
