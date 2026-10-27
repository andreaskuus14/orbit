// MEMORY → Palace: a walkable alien hall. Pure layout + collision, no Three/React. Rooms (one per memory kind) sit on a
// ring around a round hub, each joined to it by a straight corridor; plinths stand in rings inside a room, the most
// important nearest its centre, with a clear lane from the doorway. Units are metres-ish (eye height 1.6).

export type PalaceItem = { id: string; kind: string; source: string | null; links: number };
export type Plinth = { id: string; room: number; x: number; z: number; size: number }; // size 0..1 = importance
export type Room = { kind: string; x: number; z: number; r: number; angle: number; count: number };
export type Seg = { x1: number; z1: number; x2: number; z2: number };
export type Palace = { hub: number; rooms: Room[]; corridors: Seg[]; plinths: Plinth[]; walls: Seg[] };

export const PLAYER = 0.35, CORRIDOR = 2.4, SPACING = 2.2, GAP = 2;
const DOOR_LANE = 1.4; // clear width (each side of the lane centre) kept free of plinths from the doorway to the centre

/** 0..1 from what the map knows about a memory: explicit links, CORE-learned, decisions and goals weigh more. */
export function importance(m: Pick<PalaceItem, "kind" | "source" | "links">): number {
  const kind = m.kind === "decision" || m.kind === "goal" ? 0.25 : 0;
  return Math.min(1, 0.2 + Math.min(m.links, 5) * 0.1 + kind + (m.source?.startsWith("core") ? 0.05 : 0));
}

/** Plinth slots around (0,0), inner rings first, leaving a lane toward `door` (radians) free. */
function slots(n: number, door: number) {
  const out: { x: number; z: number }[] = [];
  for (let ring = 1; out.length < n; ring++) {
    const rho = 0.6 + ring * SPACING, k = Math.floor((2 * Math.PI * rho) / SPACING);
    for (let j = 0; j < k && out.length < n; j++) {
      const a = door + ((j + 0.5) / k) * 2 * Math.PI, x = Math.cos(a) * rho, z = Math.sin(a) * rho;
      // distance from the lane (the ray from the centre toward the door)
      const along = x * Math.cos(door) + z * Math.sin(door), off = Math.abs(-x * Math.sin(door) + z * Math.cos(door));
      if (along > 0 && off < DOOR_LANE + 0.6) continue;
      out.push({ x, z });
    }
    if (ring > 400) break; // unreachable guard
  }
  return out;
}

function distSeg(px: number, pz: number, s: Seg) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (pz - s.z1) * dz) / l2)) : 0;
  return Math.hypot(px - (s.x1 + t * dx), pz - (s.z1 + t * dz));
}

/** Lays out the hall. Journal entries stay out unless `includeJournal` (his private toggle). Deterministic. */
export function buildPalace(items: PalaceItem[], includeJournal = false): Palace {
  const groups = new Map<string, PalaceItem[]>();
  for (const m of items) {
    if (m.kind === "journal" && !includeJournal) continue;
    const g = groups.get(m.kind) ?? [];
    g.push(m); groups.set(m.kind, g);
  }
  const kinds = [...groups.keys()].sort();
  const sized = kinds.map((kind) => {
    const ms = [...groups.get(kind)!].sort((a, b) => importance(b) - importance(a) || a.id.localeCompare(b.id));
    const local = slots(ms.length, 0); // door at local angle 0, rotated into place below
    const r = Math.max(4, ...local.map((p) => Math.hypot(p.x, p.z) + 1.8));
    return { kind, ms, local, r };
  });
  // angles: each room gets a share of the circle proportional to its width
  const total = sized.reduce((s, g) => s + 2 * g.r + GAP, 0);
  let acc = 0;
  const angles = sized.map((g) => { const a = ((acc + g.r + GAP / 2) / total) * 2 * Math.PI; acc += 2 * g.r + GAP; return a; });
  const n = sized.length;
  let hub = 5;
  for (let i = 0; n > 1 && i < n; i++) {
    const d = (angles[(i + 1) % n] - angles[i] + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    hub = Math.max(hub, (CORRIDOR + 1.5) / Math.min(d, Math.PI));
  }
  // ring radius: grow until rooms keep apart and no corridor grazes another room
  let D = hub + 4 + Math.max(0, ...sized.map((g) => g.r));
  const ok = () => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = angles[i], b = angles[j], ri = sized[i].r, rj = sized[j].r;
      const cx = Math.cos(b) * D, cz = Math.sin(b) * D;
      if (j > i && Math.hypot(Math.cos(a) * D - cx, Math.sin(a) * D - cz) < ri + rj + GAP) return false;
      const c: Seg = { x1: Math.cos(a) * hub, z1: Math.sin(a) * hub, x2: Math.cos(a) * (D - ri), z2: Math.sin(a) * (D - ri) };
      if (distSeg(cx, cz, c) < rj + CORRIDOR / 2 + 1) return false;
    }
    return true;
  };
  for (let k = 0; k < 200 && !ok(); k++) D *= 1.08;

  const rooms: Room[] = [], corridors: Seg[] = [], plinths: Plinth[] = [];
  sized.forEach((g, i) => {
    const a = angles[i], x = Math.cos(a) * D, z = Math.sin(a) * D, door = a + Math.PI; // the doorway faces the hub
    rooms.push({ kind: g.kind, x, z, r: g.r, angle: a, count: g.ms.length });
    corridors.push({ x1: Math.cos(a) * (hub - 0.5), z1: Math.sin(a) * (hub - 0.5), x2: Math.cos(a) * (D - g.r + 0.5), z2: Math.sin(a) * (D - g.r + 0.5) });
    g.ms.forEach((m, k) => {
      const p = g.local[k], c = Math.cos(door), s = Math.sin(door);
      plinths.push({ id: m.id, room: i, x: x + p.x * c - p.z * s, z: z + p.x * s + p.z * c, size: importance(m) });
    });
  });
  return { hub, rooms, corridors, plinths, walls: walls(hub, rooms) };
}

/** Wall segments: each circle in ~2 m pieces with gaps at doorways, plus both sides of every corridor. */
function walls(hub: number, rooms: Room[]): Seg[] {
  const out: Seg[] = [];
  const circle = (cx: number, cz: number, r: number, doors: number[]) => {
    const k = Math.max(12, Math.ceil((2 * Math.PI * r) / 2)), half = Math.asin(Math.min(1, CORRIDOR / 2 / r));
    for (let j = 0; j < k; j++) {
      const a0 = (j / k) * 2 * Math.PI, a1 = ((j + 1) / k) * 2 * Math.PI, mid = (a0 + a1) / 2;
      if (doors.some((d) => Math.abs(Math.atan2(Math.sin(mid - d), Math.cos(mid - d))) < half + Math.PI / k)) continue;
      out.push({ x1: cx + Math.cos(a0) * r, z1: cz + Math.sin(a0) * r, x2: cx + Math.cos(a1) * r, z2: cz + Math.sin(a1) * r });
    }
  };
  circle(0, 0, hub, rooms.map((r) => r.angle));
  rooms.forEach((r) => circle(r.x, r.z, r.r, [r.angle + Math.PI]));
  const w2 = (CORRIDOR / 2) ** 2;
  rooms.forEach((r) => { // corridor sides, from where they meet the hub's wall to where they meet the room's
    const ux = Math.cos(r.angle), uz = Math.sin(r.angle), nx = -uz * CORRIDOR / 2, nz = ux * CORRIDOR / 2;
    const t0 = Math.sqrt(Math.max(0, hub * hub - w2)), t1 = Math.hypot(r.x, r.z) - Math.sqrt(Math.max(0, r.r * r.r - w2));
    for (const s of [1, -1]) out.push({ x1: ux * t0 + nx * s, z1: uz * t0 + nz * s, x2: ux * t1 + nx * s, z2: uz * t1 + nz * s });
  });
  return out;
}

/** Can the player stand at (x, z)? Inside the hub, a room or a corridor (with body margin), and not inside a plinth. */
export function walkable(p: Palace, x: number, z: number): boolean {
  let inside = Math.hypot(x, z) <= p.hub - PLAYER;
  for (let i = 0; !inside && i < p.rooms.length; i++) {
    const r = p.rooms[i];
    inside = Math.hypot(x - r.x, z - r.z) <= r.r - PLAYER || distSeg(x, z, p.corridors[i]) <= CORRIDOR / 2 - PLAYER;
  }
  if (!inside) return false;
  for (const q of p.plinths) if (Math.abs(x - q.x) < 2 && Math.abs(z - q.z) < 2 && Math.hypot(x - q.x, z - q.z) < plinthRadius(q.size) + PLAYER) return false;
  return true;
}
export const plinthRadius = (size: number) => 0.35 + size * 0.25;

/** One step: the full move if it stays walkable, else slide along x or z, else stay. */
export function move(p: Palace, x: number, z: number, dx: number, dz: number): [number, number] {
  if (walkable(p, x + dx, z + dz)) return [x + dx, z + dz];
  if (walkable(p, x + dx, z)) return [x + dx, z];
  if (walkable(p, x, z + dz)) return [x, z + dz];
  return [x, z];
}
