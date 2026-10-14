export type PlanetId = "memory" | "intelligence" | "creation" | "operations" | "agents" | "life" | "vault" | "analytics";
export type PanelId = PlanetId | "core" | "profile";

export type PlanetDef = {
  id: PlanetId; name: string; color: string; radius: number; speed: number; size: number;
  blurb: string; phase: number; live: boolean; // live = a working workspace exists in this build
};

export const PLANETS: PlanetDef[] = [
  { id: "memory", name: "MEMORY", color: "#8b5cf6", radius: 4.6, speed: 0.11, size: 0.6, phase: 1, live: true, blurb: "Your second brain: notes, ideas, links, decisions." },
  { id: "intelligence", name: "INTELLIGENCE", color: "#22d3ee", radius: 6.8, speed: 0.09, size: 0.5, phase: 2, live: true, blurb: "Live news and Pulse briefings, every story sourced." },
  { id: "creation", name: "CREATION", color: "#f472b6", radius: 9, speed: 0.075, size: 0.55, phase: 4, live: true, blurb: "Game Lab: play Planet Forge and future game projects." },
  { id: "operations", name: "OPERATIONS", color: "#38bdf8", radius: 11.2, speed: 0.065, size: 0.5, phase: 3, live: true, blurb: "Agent tasks, projects and your automations." },
  { id: "agents", name: "AGENTS", color: "#a78bfa", radius: 13.4, speed: 0.055, size: 0.6, phase: 3, live: true, blurb: "Your AI workforce: Nova, Atlas, Pulse, Echo, Forge and more." },
  { id: "life", name: "LIFE", color: "#34d399", radius: 15.6, speed: 0.048, size: 0.5, phase: 3, live: false, blurb: "Calendar, habits and routines." },
  { id: "vault", name: "VAULT", color: "#fbbf24", radius: 17.8, speed: 0.04, size: 0.5, phase: 3, live: false, blurb: "Files and digital assets (Drive and cloud storage)." },
  { id: "analytics", name: "ANALYTICS", color: "#60a5fa", radius: 20, speed: 0.034, size: 0.55, phase: 1, live: true, blurb: "Your real activity and AI usage." },
];

export const planetById = (id: string) => PLANETS.find((p) => p.id === id);
