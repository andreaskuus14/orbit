"use client";
// The shared work-status badge (vocabulary: ops-status-pure). Stop-all state comes from StopAll's broadcast, so held work never reads as running.
import { useEffect, useState } from "react";
import { STOP_ALL_EVENT, STOP_ALL_REQUEST_EVENT, type StopAllDetail } from "@/lib/stop-all-pure";
import { OPS_TONE, hostOffline, opsStatus } from "@/lib/ops-status-pure";
import { timeAgo } from "@/lib/mission-pure";
import { useT } from "./i18n";

export function useStopAllOn() { return useStopAll().on; }

/** Stop-all state and the host heartbeat (host: last beat ISO, null = never, undefined = not loaded yet). */
export function useStopAll() {
  const [st, setSt] = useState<StopAllDetail>({ on: false });
  useEffect(() => {
    const h = (e: Event) => setSt((e as CustomEvent<StopAllDetail>).detail ?? { on: false });
    addEventListener(STOP_ALL_EVENT, h);
    dispatchEvent(new Event(STOP_ALL_REQUEST_EVENT));
    return () => removeEventListener(STOP_ALL_EVENT, h);
  }, []);
  return st;
}

/** raw: any task / step / chain / mission status. label overrides the word (e.g. "Done · verified") but not the tone. at: last progress. */
export function OpsStatus({ raw, pending, at, label }: { raw: string; pending?: unknown; at?: string; label?: string }) {
  const { t } = useT();
  const st = useStopAll(), off = hostOffline(st.host);
  const s = opsStatus(raw, { stopAll: st.on, pending, hostOffline: off });
  const live = s !== "complete" && s !== "cancelled";
  const down = off && opsStatus(raw) === "running"; // says why it isn't running: the host stopped beating
  return <span style={{ color: OPS_TONE[s] }} data-status={s}>{s === "complete" && label ? label : t(`ops.state.${s}`)}
    {down ? <span className="muted"> · {st.host ? t("ops.hostOfflineSince", { ago: timeAgo(st.host) }) : t("ops.hostOffline")}</span>
      : live && at && <span className="muted"> · {t("ops.lastProgress", { ago: timeAgo(at) })}</span>}</span>;
}
