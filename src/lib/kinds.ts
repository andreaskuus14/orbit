// Client-safe copy of the memory kinds (lib/memory.ts imports node:dns, so it can't be bundled for the browser).
export const KINDS = ["note", "idea", "link", "document", "image", "research", "conversation", "project", "preference", "decision", "goal", "journal", "episode"] as const; // journal: "Today in a minute" (migration 0017); episode: episodes.ts (0018)
export type Kind = (typeof KINDS)[number];
