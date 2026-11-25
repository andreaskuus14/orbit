// The workspace planets that open as explorable 3D worlds (scenes live in PlanetScenes + planet-scenes-pure).
export const PLANET_WORLDS = ["operations", "life", "vault", "analytics", "business"] as const;
export type PlanetWorldId = (typeof PLANET_WORLDS)[number];
export const isPlanetWorld = (id: unknown): id is PlanetWorldId => (PLANET_WORLDS as readonly unknown[]).includes(id);
