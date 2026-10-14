// Minimal TopoJSON → polygon rings decoder for world-atlas (avoids a topojson-client dependency).
// Returns each country as a list of rings of [lon, lat] points.

type Topology = {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: Record<string, { geometries: { type: string; arcs?: unknown; properties?: { name?: string }; id?: string }[] }>;
};
export type CountryShape = { name: string; id: string; rings: [number, number][][] };

export function decodeCountries(topo: Topology, object = "countries"): CountryShape[] {
  const t = topo.transform;
  // Arcs are delta-encoded integers when quantized.
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      if (!t) return [dx, dy] as [number, number];
      x += dx; y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]] as [number, number];
    });
  });
  const ring = (ids: number[]) => {
    const out: [number, number][] = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      // Consecutive arcs share their joining point; skip the duplicate.
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  return topo.objects[object].geometries.flatMap((g) => {
    const polys = g.type === "Polygon" ? [g.arcs as number[][]] : g.type === "MultiPolygon" ? (g.arcs as number[][][]) : [];
    if (!polys.length) return [];
    return [{ name: g.properties?.name ?? "", id: String(g.id ?? ""), rings: polys.flatMap((p) => p.map(ring)) }];
  });
}

/** Makes a ring's longitudes continuous across the antimeridian (e.g. Russia, Fiji) so it can be drawn without streaks. */
export function unwrapRing(r: [number, number][]): [number, number][] {
  // Polar rings (Antarctica) run along ±180° down to the pole; they're already drawable as-is.
  if (r.some(([, lat]) => lat <= -89.9)) return r;
  const out: [number, number][] = [];
  let shift = 0;
  for (let i = 0; i < r.length; i++) {
    if (i) {
      const d = r[i][0] - r[i - 1][0];
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    out.push([r[i][0] + shift, r[i][1]]);
  }
  return out;
}
