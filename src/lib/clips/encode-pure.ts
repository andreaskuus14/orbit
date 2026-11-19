// Video encoder for rendered Shorts. nvenc = the RTX card's hardware encoder (frees the CPU for the filters and is
// faster); x264 = the CPU fallback. Both aim at the same look: CQ 23 on NVENC ≈ CRF 21 on x264 at 1080x1920.
export type VideoEncoder = "nvenc" | "x264";

export const videoCodec = (e: VideoEncoder): string[] => e === "nvenc"
  ? ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-maxrate", "16M", "-bufsize", "32M", "-pix_fmt", "yuv420p"]
  : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"];
