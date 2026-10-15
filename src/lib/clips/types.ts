// Clip Factory contract shared by the server (src/lib/clips/factory.ts) and the STUDIO UI.
export type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
export type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: ClipStatus; video?: string; thumb?: string; error?: string }; // video/thumb = paths relative to the studio root, "/" separators
export type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
export type ClipJob = { id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: { count: number; maxSec: number; captions: boolean } };
export type InboxFile = { name: string; size: number; mtime: string; jobId?: string; permission?: string }; // permission: from <name>.source.json
export type ToolsStatus = { ffmpeg: boolean; transcriber: boolean; ytdlp: boolean; missing: string[] };
export type DownloadStatus = "queued" | "downloading" | "done" | "failed";
export type Download = { id: string; url: string; status: DownloadStatus; progress: number; step: string; file?: string; error?: string; createdAt: string;
  permission: string; autoClip?: ClipJob["options"]; parts?: string[] }; // parts: inbox files yt-dlp is still writing (deleted if it fails)
