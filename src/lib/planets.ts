export type PlanetId = "memory" | "intelligence" | "creation" | "operations" | "agents" | "life" | "vault" | "analytics" | "studio" | "theater" | "markets" | "business";
export type PanelId = PlanetId | "core" | "profile";

export type PlanetDef = {
  id: PlanetId; name: string; color: string; radius: number; speed: number; size: number;
  blurb: string; phase: number; live: boolean; // live = a working workspace exists in this build
};

export const PLANETS: PlanetDef[] = [
  { id: "memory", name: "MEMORY", color: "#8b5cf6", radius: 4.6, speed: 0.11, size: 0.6, phase: 1, live: true, blurb: "Your second brain: notes, ideas, links, decisions." },
  { id: "intelligence", name: "INTELLIGENCE", color: "#22d3ee", radius: 6.8, speed: 0.09, size: 0.5, phase: 2, live: true, blurb: "Live news and Pulse briefings, every story sourced." },
  { id: "creation", name: "GAME DEV", color: "#f472b6", radius: 9, speed: 0.075, size: 0.55, phase: 4, live: true, blurb: "Your games: art, bug tracker, QA playtests and Planet Forge." },
  { id: "operations", name: "OPERATIONS", color: "#38bdf8", radius: 13, speed: 0.065, size: 0.5, phase: 3, live: true, blurb: "Agent tasks, projects and your automations." },
  { id: "agents", name: "AGENTS", color: "#a78bfa", radius: 19.6, speed: 0.055, size: 0.6, phase: 3, live: true, blurb: "Your AI workforce: Nova, Atlas, Pulse, Echo, Forge and more." },
  { id: "life", name: "LIFE", color: "#34d399", radius: 24, speed: 0.048, size: 0.5, phase: 3, live: true, blurb: "Habits with streaks, reminders, focus timer and a daily journal." },
  { id: "vault", name: "VAULT", color: "#fbbf24", radius: 26.3, speed: 0.04, size: 0.5, phase: 3, live: true, blurb: "Your private file vault: drop files in, preview, search inside, ask CORE." },
  { id: "analytics", name: "ANALYTICS", color: "#60a5fa", radius: 29.3, speed: 0.034, size: 0.55, phase: 1, live: true, blurb: "Your real activity and AI usage." },
  // Beyond the outer belt (32–34): the YouTube channel sits apart as its own system.
  { id: "studio", name: "STUDIO", color: "#f43f5e", radius: 37, speed: 0.03, size: 0.6, phase: 4, live: true, blurb: "Your YouTube channel: videos as moons, comets when one takes off." },
  { id: "theater", name: "THEATER", color: "#f59e0b", radius: 40.5, speed: 0.027, size: 0.5, phase: 4, live: true, blurb: "Find a creator's newest videos by voice and watch them on the big screen." },
  { id: "markets", name: "MARKETS", color: "#10b981", radius: 44, speed: 0.024, size: 0.5, phase: 4, live: true, blurb: "Watchlist, portfolio tracking, alerts and paper trading. Simulation only, not advice." },
  { id: "business", name: "BUSINESS", color: "#38bdf8", radius: 47.5, speed: 0.021, size: 0.5, phase: 4, live: true, blurb: "Your client pipeline: businesses to contact, pilots, paying clients, and CORE-drafted first messages." },
];

export const planetById = (id: string) => PLANETS.find((p) => p.id === id);
