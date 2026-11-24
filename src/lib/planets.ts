export type PlanetId = "memory" | "intelligence" | "creation" | "operations" | "agents" | "life" | "vault" | "analytics" | "studio" | "business" | "arch";
export type PanelId = PlanetId | "core" | "profile";

export type PlanetDef = {
  id: PlanetId; name: string; color: string; radius: number; speed: number; size: number;
  blurb: string; phase: number; live: boolean; // live = a working workspace exists in this build
};

export const PLANETS: PlanetDef[] = [
  { id: "memory", name: "MEMORY", color: "#8b5cf6", radius: 4.6, speed: 0.11, size: 0.6, phase: 1, live: true, blurb: "What ORBIT remembers for you: notes, ideas, people, decisions." },
  { id: "intelligence", name: "INTELLIGENCE", color: "#22d3ee", radius: 6.8, speed: 0.09, size: 0.5, phase: 2, live: true, blurb: "News that matters to you, with a short daily briefing." },
  { id: "creation", name: "GAME DEV", color: "#f472b6", radius: 9, speed: 0.075, size: 0.55, phase: 4, live: true, blurb: "Your games: ORBIT builds, tests and fixes them." },
  { id: "operations", name: "OPERATIONS", color: "#38bdf8", radius: 13, speed: 0.065, size: 0.5, phase: 3, live: true, blurb: "Every job ORBIT is doing, and the ones it does on a schedule." },
  { id: "agents", name: "AGENTS", color: "#a78bfa", radius: 19.6, speed: 0.055, size: 0.6, phase: 3, live: true, blurb: "Your AI helpers and the goals they work on." },
  { id: "life", name: "LIFE", color: "#34d399", radius: 24, speed: 0.048, size: 0.5, phase: 3, live: true, blurb: "Habits, reminders, school and your private journal." },
  { id: "vault", name: "VAULT", color: "#fbbf24", radius: 26.3, speed: 0.04, size: 0.5, phase: 3, live: true, blurb: "Your files: ORBIT sorts them and finds things inside." },
  { id: "analytics", name: "ANALYTICS", color: "#60a5fa", radius: 29.3, speed: 0.034, size: 0.55, phase: 1, live: true, blurb: "How you spent your time, and what the AI cost." },
  // Beyond the outer belt (32–34): the YouTube channel sits apart as its own system.
  { id: "studio", name: "STUDIO", color: "#f43f5e", radius: 37, speed: 0.03, size: 0.6, phase: 4, live: true, blurb: "Your YouTube channel: Shorts, videos and how they do." },
  { id: "business", name: "BUSINESS", color: "#fb923c", radius: 47.5, speed: 0.021, size: 0.5, phase: 4, live: true, blurb: "Finding clients, first messages and follow-ups. Nothing is sent without you." },
  { id: "arch", name: "ARCH", color: "#a3e635", radius: 51, speed: 0.019, size: 0.55, phase: 4, live: true, blurb: "Design a house in 3D by talking, with amounts and costs." },
];

export const planetById = (id: string) => PLANETS.find((p) => p.id === id);
