// Game Lab catalogue. Server-safe (no React): the API uses it to validate saves and settings, the UI to list projects.
// To add a game: write its rules module, add an entry here, and add its component to GAME_COMPONENTS in GameLab.tsx.
// Games are reviewed source code only. ORBIT never evaluates generated code; agents may only change validated settings.
import * as forge from "./planet-forge/rules";

export type SettingSpec = { label: string; help: string; min: number; max: number; step: number; def: number };
export type GameMeta = {
  id: string; name: string; tagline: string; description: string; accent: string;
  controls: [string, string][];
  settingsSpec: Record<string, SettingSpec>;
  defaults: Record<string, number>;
  validateSettings: (raw: unknown) => { ok: true; settings: Record<string, number> } | { ok: false; errors: Record<string, string> };
  validateSave: (raw: unknown) => { ok: true } | { ok: false; error: string };
};

export const GAMES: GameMeta[] = [
  {
    id: "planet-forge",
    name: "Planet Forge",
    tagline: "Mine a tiny solar system and decide what each world becomes.",
    description: "Pilot a mining ship around three planets. Heavy mining scars and destabilises a world; factories boost output but pollute; restoration grows forests and renewable energy. Upgrade your ship and build a jump gate out of the system. About 10–15 minutes.",
    accent: "#f472b6",
    controls: [
      ["WASD / arrows", "Fly"], ["Click", "Fly to a planet or point"], ["Space (hold)", "Mine"], ["Tab / 1-3", "Select planet"],
      ["I / R / X", "Industry / Restore / Decommission"], ["U", "Upgrades"], ["B", "Deliver to gate"], ["Esc", "Pause"], ["M", "Mute"],
    ],
    settingsSpec: forge.SETTINGS_SPEC,
    defaults: forge.DEFAULT_SETTINGS,
    validateSettings: forge.validateSettings,
    validateSave: (raw) => { const r = forge.parseSave(raw); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
  },
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
