// Clip Factory contract shared by the server (src/lib/clips/factory.ts) and the STUDIO UI.
import type { Critique } from "./titles";
import type { HypeView } from "./hype-pure";
import type { Virality } from "./score-pure";
export type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
export type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: ClipStatus; video?: string; thumb?: string; error?: string; publish?: ClipPublish; // video/thumb = paths relative to the studio root, "/" separators
  titleOptions?: { text: string; score: number }[]; thumbOptions?: string[]; // owner's picks: choosing one sets title / thumb (thumbOptions: same path form as thumb)
  critic?: Critique; // title critics' review of titleOptions (critiqueClip in learn.ts)
  variantOf?: string; edit?: VersionEdit; // a "make another version" render: the original clip's id and the settings it was rendered with
  virality?: Virality; // personal virality score + the features it was computed from (score-pure.ts); learned from once published
  original?: string }; // owner's note of their own layer (commentary, reaction, analysis); required to publish another creator's clip (publish-checks-pure.ts)
// unknown: the upload may or may not have reached YouTube; checked against the channel's uploads before a retry is offered.
// scheduled: on YouTube as private, YouTube makes it public at scheduledFor (ISO; also set while uploading/unknown when one was asked for).
export type ClipPublish = { status: "uploading" | "done" | "scheduled" | "failed" | "unknown"; progress?: number; videoId?: string; url?: string; privacy?: string; error?: string; at: string;
  startedAt?: string; title?: string; scheduledFor?: string }; // what was sent and when: matched against the channel's uploads
export type CaptionStyle = "karaoke" | "classic" | "none";
// layout follow: crop tracks the action (reframe.ts). camSide tl/tr/bl/br: split with a corner cam box (camSize = box width / frame width) on top.
export type VersionEdit = { layout: "fit" | "fill" | "split" | "follow"; camSide: "left" | "right" | "tl" | "tr" | "bl" | "br"; camSize?: number; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean;
  coldOpen?: boolean; progressBar?: boolean; loopEnd?: boolean }; // optional: versions saved before these existed (baseEdit fills them)
export type FeedbackAction = "approved" | "rejected" | "version" | "published";
export type Feedback = { clipId: string; action: FeedbackAction; reason?: string; at: string };
export type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
export type ClipJob = { v?: number; id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: ClipOptions;
  permission?: string; // source/permission note (inbox auto-clip: from <video>.source.txt / .source.json)
  timings?: { audio: number; transcribe: number; pick: number; render: number }; // seconds per stage
  feedback?: Feedback[]; // review decisions, kept for learning what makes a good clip
  resumes?: number; // times re-queued automatically after ORBIT restarted mid-run (max 1)
  devlogDay?: number; // devlog preset: this recording's "Day N" (taken from the series counter once, on the first run)
  hype?: HypeView }; // hype timeline (chat + audio) for the HypeWave, downsampled (hype-pure.ts)
// The edit options are optional: jobs saved before they existed get the defaults (validOptions({})).
export type ClipOptions = { count: number; maxSec: number; captions: boolean; layout?: VersionEdit["layout"]; camSide?: VersionEdit["camSide"]; camSize?: number;
  jumpCuts?: boolean; zooms?: boolean; language?: "auto" | "en";
  coldOpen?: boolean; progressBar?: boolean; loopEnd?: boolean; // retention edits: teaser of the peak first, bottom progress bar, trimmed tail + audio fade
  preset?: "viral" | "devlog" }; // moment-picking style: streamer highlights, or game-dev progress (devlog.ts); missing = viral
export type InboxFile = { name: string; size: number; mtime: string; jobId?: string; permission?: string }; // permission: from <name>.source.json
export type ToolsStatus = { ffmpeg: boolean; transcriber: boolean; ytdlp: boolean; missing: string[] };
export type DownloadStatus = "queued" | "downloading" | "done" | "failed";
export type Download = { v?: number; id: string; url: string; status: DownloadStatus; progress: number; step: string; file?: string; error?: string; createdAt: string;
  permission: string; autoClip?: ClipJob["options"]; parts?: string[]; // parts: inbox files yt-dlp is still writing (deleted if it fails)
  warning?: string }; // e.g. low disk space before the download started (never fails it)
/** A job/download state file that couldn't be read, moved aside (never deleted). file: studio-root relative, "/" separators. */
export type Quarantined = { file: string; reason: string; at: string };
