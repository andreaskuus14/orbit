// Video encoder for rendered Shorts. nvenc = the RTX card's hardware encoder (frees the CPU for the filters and is
// faster); x264 = the CPU fallback. Both aim at the same look: CQ 23 on NVENC ≈ CRF 21 on x264 at 1080x1920.
export type VideoEncoder = "nvenc" | "x264";

export const videoCodec = (e: VideoEncoder): string[] => e === "nvenc"
  ? ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-maxrate", "16M", "-bufsize", "32M", "-pix_fmt", "yuv420p"]
  : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"];

/** Waiting for the GPU lease to render with NVENC ended without a lease: the GPU stayed busy too long ("timeout") → render this
 *  clip on the CPU; Stop-all ("stop") or a cancelled job → null (stop, no render). */
export const encoderAfterWait = (reason: "timeout" | "stop" | "cancel"): VideoEncoder | null => (reason === "timeout" ? "x264" : null);

/** NVENC failed mid-render: redo the clip on the CPU (after releasing the GPU lease), unless it already was the CPU or the job was cancelled. */
export const retryOnCpu = (enc: VideoEncoder, aborted: boolean) => enc === "nvenc" && !aborted;
