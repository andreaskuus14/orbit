// Ollama (the local brain + document OCR) after a reboot: ORBIT starts it itself when it is installed but not answering, like ComfyUI
// and Local AI. Pure rules: where the program can be, and the plain Doctor line. IO: ollama-start.ts.
import { check, type Check } from "./doctor-pure.ts";

export type OllamaStart =
  | { state: "running" }                         // answered without help
  | { state: "started"; at: number; ms: number } // ORBIT started it and it answered
  | { state: "missing" }                         // no ollama program found
  | { state: "failed"; at: number; why: string } // found, started, but it never answered
  | { state: "off" }                             // ORBIT_OLLAMA_AUTOSTART=0 and it isn't running
  | { state: "unused" };                         // no local brain model set and OCR off

/** Places the ollama program can be, most likely first. ORBIT_OLLAMA_EXE wins. "ollama" = whatever PATH finds (tried last). */
export function ollamaExeCandidates(env: Record<string, string | undefined>, platform: string): string[] {
  const own = env.ORBIT_OLLAMA_EXE?.trim();
  const win = platform === "win32";
  const join = (...p: string[]) => p.join(win ? "\\" : "/");
  const list = win
    ? [env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"), env.ProgramFiles && join(env.ProgramFiles, "Ollama", "ollama.exe")]
    : platform === "darwin" ? ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"] : ["/usr/local/bin/ollama", "/usr/bin/ollama"];
  return [...new Set([own, ...list, "ollama"].filter((x): x is string => !!x))];
}

/** Does anything in ORBIT need Ollama right now? (a local brain model is set, or document OCR is on) */
export const ollamaWanted = (localModel: string, ocrOn: boolean) => !!localModel || ocrOn;

const L = "Local brain (Ollama)";
const SETUP = "Run: powershell -ExecutionPolicy Bypass -File tools\\ollama\\setup.ps1";
/** The Doctor's line, in plain words. */
export function ollamaCheck(s: OllamaStart): Check {
  switch (s.state) {
    case "running": return check("ollama", L, "ok", "Running");
    case "started": return check("ollama", L, "ok", `Wasn't running, so ORBIT started it (ready in ${Math.max(1, Math.round(s.ms / 1000))} s)`);
    case "unused": return check("ollama", L, "ok", "Not used (no local model set, OCR off)");
    case "missing": return check("ollama", L, "warn", "Ollama isn't installed, so the offline brain and reading scanned documents don't work", SETUP);
    case "off": return check("ollama", L, "warn", "Ollama isn't running, and ORBIT is set not to start it (ORBIT_OLLAMA_AUTOSTART=0)", "Start Ollama from the Start menu, or remove ORBIT_OLLAMA_AUTOSTART=0 from .env.local.");
    case "failed": return check("ollama", L, "fail", `Ollama is installed but ORBIT couldn't start it: ${s.why.slice(0, 160)}`,
      "Open Ollama from the Start menu. If it closes again, run `ollama serve` in a terminal and read the error, then run this check again.");
  }
}
