// Clip Factory contract shared by the server (src/lib/clips/factory.ts) and the STUDIO UI.
export type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
export type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: ClipStatus; video?: string; thumb?: string; error?: string; publish?: ClipPublish; // video/thumb = paths relative to the studio root, "/" separators
  variantOf?: string; edit?: VersionEdit }; // a "make another version" render: the original clip's id and the settings it was rendered with
// unknown: the upload may or may not have reached YouTube; checked against the channel's uploads before a retry is offered.
export type ClipPublish = { status: "uploading" | "done" | "failed" | "unknown"; progress?: number; videoId?: string; url?: string; privacy?: string; error?: string; at: string;
  startedAt?: string; title?: string }; // what was sent and when: matched against the channel's uploads
export type CaptionStyle = "karaoke" | "classic" | "none";
export type VersionEdit = { layout: "fit" | "fill" | "split"; camSide: "left" | "right"; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean };
export type FeedbackAction = "approved" | "rejected" | "version" | "published";
export type Feedback = { clipId: string; action: FeedbackAction; reason?: string; at: string };
export type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
export type ClipJob = { v?: number; id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: ClipOptions;
  timings?: { audio: number; transcribe: number; pick: number; render: number }; // seconds per stage
  feedback?: Feedback[] }; // review decisions, kept for learning what makes a good clip
// The edit options are optional: jobs saved before they existed get the defaults (validOptions({})).
export type ClipOptions = { count: number; maxSec: number; captions: boolean; layout?: "fit" | "fill" | "split"; camSide?: "left" | "right";
  jumpCuts?: boolean; zooms?: boolean; language?: "auto" | "en" };
export type InboxFile = { name: string; size: number; mtime: string; jobId?: string; permission?: string }; // permission: from <name>.source.json
export type ToolsStatus = { ffmpeg: boolean; transcriber: boolean; ytdlp: boolean; missing: string[] };
export type DownloadStatus = "queued" | "downloading" | "done" | "failed";
export type Download = { v?: number; id: string; url: string; status: DownloadStatus; progress: number; step: string; file?: string; error?: string; createdAt: string;
  permission: string; autoClip?: ClipJob["options"]; parts?: string[] }; // parts: inbox files yt-dlp is still writing (deleted if it fails)
/** A job/download state file that couldn't be read, moved aside (never deleted). file: studio-root relative, "/" separators. */
export type Quarantined = { file: string; reason: string; at: string };
