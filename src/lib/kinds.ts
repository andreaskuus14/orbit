// Client-safe copy of the memory kinds (lib/memory.ts imports node:dns, so it can't be bundled for the browser).
export const KINDS = ["note", "idea", "link", "document", "image", "research", "conversation", "project", "preference", "decision", "goal"] as const;
export type Kind = (typeof KINDS)[number];
