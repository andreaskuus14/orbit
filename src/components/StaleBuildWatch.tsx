"use client";
// Keeps a tab that was open across a live update working. The launcher swaps .next, so the old build's lazy chunks can
// 404: a chunk error (in a planet's boundary or anywhere on window) reloads the page once, keeping the URL hash so the
// same planet reopens. It also asks /api/health for the server's build (on focus / visible, and every POLL_MS while
// visible); when it differs from the build this page loaded, a calm toast offers Reload and the next planet open reloads.
// Rules in lib/stale-build-pure.ts.
import { useEffect, useRef } from "react";
import { buildChanged, isChunkError, mayReload, POLL_MS, RELOAD_KEY, shouldCheck } from "@/lib/stale-build-pure";
import { Toaster, toast } from "./ui";
import { useT } from "./i18n";

/** Reload the page unless this tab already did so within the guard window. Returns whether it reloads. */
export function reloadOnce(): boolean {
  if (typeof window === "undefined") return false;
  let last: string | null = null;
  try { last = sessionStorage.getItem(RELOAD_KEY); } catch { /* storage off: still reload once per page load below */ }
  const now = Date.now();
  if (!mayReload(last, now) || (window as { __orbitReloading?: boolean }).__orbitReloading) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(now)); } catch { /* storage off: can't guard across loads; don't loop */ return false; }
  (window as { __orbitReloading?: boolean }).__orbitReloading = true;
  location.reload(); // same URL, hash included: the planet that was opening opens again
  return true;
}

async function serverBuild(): Promise<string | null> {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { buildId?: string | null }).buildId ?? null;
  } catch { return null; } // server restarting: try again next time
}

export function StaleBuildWatch({ open }: { open: string | null }) {
  const { t } = useT();
  const page = useRef<string | null>(null); // the build this page came from (first answer after load)
  const stale = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const onErr = (e: Event) => { if (isChunkError(e)) reloadOnce(); };
    addEventListener("error", onErr, true); // capture: a failed <script>/<link> load doesn't bubble
    addEventListener("unhandledrejection", onErr);

    let last = -Infinity, alive = true;
    const check = async (force = false) => {
      const now = Date.now(), visible = document.visibilityState === "visible";
      if (stale.current || (!force && !shouldCheck(last, now, visible))) return;
      last = now;
      const id = await serverBuild();
      if (!alive || !id) return;
      if (!page.current) { page.current = id; return; }
      if (buildChanged(page.current, id)) {
        stale.current = true;
        toast({ id: "orbit-updated", text: tRef.current("update.ready"), action: { label: tRef.current("update.reload"), onClick: () => location.reload() } });
      }
    };
    void check(true);
    const onVis = () => { void check(); };
    addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => { void check(); }, POLL_MS);
    return () => {
      alive = false; clearInterval(iv);
      removeEventListener("error", onErr, true); removeEventListener("unhandledrejection", onErr);
      removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ORBIT was updated: the next planet open reloads, after Orbit has written that planet into the URL hash.
  useEffect(() => {
    if (!open || !stale.current) return;
    const id = setTimeout(() => reloadOnce(), 50);
    return () => clearTimeout(id);
  }, [open]);

  return <Toaster dismissLabel={t("common.close")} />;
}
