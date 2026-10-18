import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { REA_LIMITS } from "./rea-pure.ts";

/** No shell or model-supplied command. Resolve only after the launched child closes. */
export async function runReaCommand(entrypoint: string, source: string, signal: AbortSignal, onProgress: (line: string) => void, limits: { outputBytes: number; timeoutMs: number } = REA_LIMITS): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // A curated environment avoids forwarding ORBIT's Supabase, OAuth and embedding credentials.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const k of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "COMSPEC", "LANG", "LC_ALL"])
      if (process.env[k] !== undefined) env[k] = process.env[k];
    const child = spawn(process.execPath, [entrypoint, "analyze-javascript-application", source, "--artifact-format", "directory", "--json", "--full-output"], { cwd: source, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stopped: Error | undefined, bytes = 0, stderrBytes = 0, pending = "";
    const chunks: Buffer[] = [], decoder = new StringDecoder("utf8");
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (force: boolean) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // taskkill acts on this still-live process tree; no PID is retained after close.
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => { child.kill("SIGKILL"); });
        killer.on("close", (code) => { if (code !== 0) child.kill("SIGKILL"); });
        // A restricted Windows session can launch taskkill but deny its process
        // inventory. The owned child handle still permits direct termination.
        if (force) child.kill("SIGKILL");
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); } catch { child.kill(force ? "SIGKILL" : "SIGTERM"); }
      }
    };
    const stop = (error: Error) => {
      if (stopped) return;
      stopped = error;
      kill(false);
      escalation = setTimeout(() => kill(true), 3000);
    };
    const abort = () => stop(new DOMException("REA analysis cancelled", "AbortError"));
    const timer = setTimeout(() => stop(new Error("REA analysis exceeded its time budget.")), limits.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limits.outputBytes) stop(new Error("REA Evidence exceeded the 32 MiB output budget; no partial success was returned."));
      else if (!stopped) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) return stop(new Error("REA diagnostic output exceeded its budget."));
      pending += decoder.write(chunk);
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      if (pending.length > 16000) return stop(new Error("REA diagnostic line exceeded its budget."));
      for (const line of lines) {
        // Treat all diagnostics as data, never instructions or a command.
        if (line.includes('"rea_progress"')) onProgress(line.slice(0, 500));
      }
    });
    let spawnError: Error | undefined;
    child.on("error", (e) => { spawnError = e; });
    child.on("close", (code) => {
      clearTimeout(timer); if (escalation) clearTimeout(escalation);
      signal.removeEventListener("abort", abort);
      if (stopped) reject(stopped);
      else if (spawnError) reject(new Error(`Could not launch the configured REA entrypoint: ${spawnError.message}`));
      else if (code !== 0) reject(new Error("REA exited unsuccessfully. Run npm run rea:setup, then check the REA command locally."));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
