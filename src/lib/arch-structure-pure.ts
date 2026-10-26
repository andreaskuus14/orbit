// ARCH structure coach (roadmap 3), pure and tested in tests/arch-structure.test.ts. A TEACHING ESTIMATE, NOT ENGINEERING:
// a structural engineer must check real designs. Simply supported one-way members under a uniform load, Eurocode-style:
// timber joists/beams in C24 (EN 338, EN 1995-1-1) and solid reinforced concrete slabs (EN 1992-1-1). Each check returns the
// working as lines with his numbers in, so he can follow it by hand. No model calls: every number comes from here.
import { RULES, type Part } from "./arch-pure.ts";

/** Residential floor, EN 1991-1-1 category A: q_k = 1.5 kN/m² imposed (Finnish/Estonian NA value for floors). */
export const LOAD = { qk: 1.5, gammaG: 1.35, gammaQ: 1.5, psi2: 0.3 }; // EN 1990 eq. 6.10 factors; ψ2 = 0.3 for category A
/** C24 from EN 338:2016 Table 1, plus EN 1995-1-1 factors for a heated interior (service class 1), medium-term load. */
export const C24 = { fmk: 24, E: 11000, rho: 420, kmod: 0.8, gammaM: 1.3, kdef: 0.6 }; // N/mm², N/mm², kg/m³, –, –, –
/** C25/30 (EN 1992-1-1 Table 3.1) and B500B; 25 mm cover + half a 10 mm bar, so d = h − 30 mm. */
export const CONC = { fck: 25, fctm: 2.6, fyk: 500, gammaS: 1.15, unitKN: 25, cover: 30, Klim: 0.167 };
export const FINISH = { timber: 0.5, concrete: 1.0 }; // kN/m²: boards + ceiling on joists, screed + finish on a slab (assumed)
export const LIMIT = 300; // deflection limit L/300 (EN 1995-1-1 Table 7.2 range L/250–L/350)

/** Common sawn C24 sizes (mm), tried smallest cross-section first. */
export const TIMBER_SIZES: [number, number][] = [45, 70, 95].flatMap((b) => [95, 120, 145, 170, 195, 220, 245, 270, 295].map((h): [number, number] => [b, h]))
  .sort((a, c) => a[0] * a[1] - c[0] * c[1]);
export const SLAB_SIZES = [120, 150, 180, 200, 220, 250, 280, 300]; // mm

export type FloorType = "timber" | "concrete";
export type Check = { ok: boolean; util: number; b: number; h: number; size: string; steps: string[] };
const f = (v: number, n = 2) => Number(v.toFixed(n)).toLocaleString("en", { maximumFractionDigits: n });

/** Timber joist (or beam: spacing = its loaded width) b × h mm over span L m, at spacing s m. */
export function timberCheck(L: number, s: number, b: number, h: number): Check {
  const gSelf = (C24.rho * 9.81 * b * h) / 1e9; // kN/m: ρ·g (N/m³) × b·h (mm² → m²) / 1000
  const G = FINISH.timber * s + gSelf, Q = LOAD.qk * s, qd = LOAD.gammaG * G + LOAD.gammaQ * Q;
  const M = (qd * L * L) / 8, W = (b * h * h) / 6, I = (b * h ** 3) / 12;
  const sigma = (M * 1e6) / W, kh = h < 150 ? Math.min((150 / h) ** 0.2, 1.3) : 1, fmd = (kh * C24.kmod * C24.fmk) / C24.gammaM;
  const Lmm = L * 1000, w = (q: number) => (5 * q * Lmm ** 4) / (384 * C24.E * I); // kN/m = N/mm
  const wG = w(G), wQ = w(Q), wFin = wG * (1 + C24.kdef) + wQ * (1 + LOAD.psi2 * C24.kdef), wLim = Lmm / LIMIT;
  const uB = sigma / fmd, uW = wFin / wLim;
  return {
    ok: uB <= 1 && uW <= 1, util: Math.max(uB, uW), b, h, size: `${b}×${h} mm C24 @ ${f(s * 1000, 0)} mm`, steps: [
      `Loads on one joist (it carries a ${f(s, 2)} m wide strip):`,
      `  self-weight g = ρ·g·b·h = ${C24.rho} kg/m³ × 9.81 × ${b / 1000} × ${h / 1000} m = ${f(gSelf, 3)} kN/m`,
      `  dead G = finishes ${FINISH.timber} kN/m² × ${f(s, 2)} m + ${f(gSelf, 3)} = ${f(G, 3)} kN/m`,
      `  imposed Q = ${LOAD.qk} kN/m² × ${f(s, 2)} m = ${f(Q, 3)} kN/m`,
      `Strength (ULS): q_d = 1.35·G + 1.5·Q = 1.35 × ${f(G, 3)} + 1.5 × ${f(Q, 3)} = ${f(qd, 3)} kN/m`,
      `  M = q_d·L²/8 = ${f(qd, 3)} × ${f(L)}² / 8 = ${f(M, 3)} kNm`,
      `  W = b·h²/6 = ${b} × ${h}² / 6 = ${f(W, 0)} mm³`,
      `  σ = M/W = ${f(M * 1e6, 0)} / ${f(W, 0)} = ${f(sigma)} N/mm²`,
      `  f_m,d = k_h·k_mod·f_m,k/γ_M = ${f(kh, 3)} × ${C24.kmod} × ${C24.fmk} / ${C24.gammaM} = ${f(fmd)} N/mm²`,
      `  ${f(sigma)} ${uB <= 1 ? "≤" : ">"} ${f(fmd)} → bending ${uB <= 1 ? "OK" : "FAILS"} (${f(uB * 100, 0)} % used)`,
      `Deflection (SLS): I = b·h³/12 = ${b} × ${h}³ / 12 = ${f(I, 0)} mm⁴, E = ${C24.E} N/mm²`,
      `  w = 5·q·L⁴/(384·E·I): from G ${f(wG)} mm, from Q ${f(wQ)} mm`,
      `  creep: w_fin = w_G·(1+k_def) + w_Q·(1+ψ2·k_def) = ${f(wG)} × ${1 + C24.kdef} + ${f(wQ)} × ${f(1 + LOAD.psi2 * C24.kdef)} = ${f(wFin)} mm`,
      `  limit L/${LIMIT} = ${f(Lmm, 0)} / ${LIMIT} = ${f(wLim)} mm → deflection ${uW <= 1 ? "OK" : "FAILS"} (${f(uW * 100, 0)} % used)`,
    ],
  };
}

/** Solid one-way RC slab h mm over span L m, per metre width. Bending (K ≤ 0.167, lever arm, steel area) + EC2 span/depth (7.16). */
export function slabCheck(L: number, h: number): Check {
  const d = h - CONC.cover, G = (CONC.unitKN * h) / 1000 + FINISH.concrete, Q = LOAD.qk, qd = LOAD.gammaG * G + LOAD.gammaQ * Q;
  const M = (qd * L * L) / 8, K = (M * 1e6) / (1000 * d * d * CONC.fck);
  const z = Math.min(0.95 * d, d * (0.5 + Math.sqrt(Math.max(0, 0.25 - K / 1.134)))), fyd = CONC.fyk / CONC.gammaS;
  const AsReq = (M * 1e6) / (fyd * z), AsMin = Math.max((0.26 * CONC.fctm) / CONC.fyk, 0.0013) * 1000 * d, As = Math.max(AsReq, AsMin);
  const rho = As / (1000 * d), rho0 = Math.sqrt(CONC.fck) * 1e-3, sq = Math.sqrt(CONC.fck);
  const lim = rho <= rho0 ? 11 + (1.5 * sq * rho0) / rho + 3.2 * sq * (rho0 / rho - 1) ** 1.5 : 11 + (1.5 * sq * rho0) / rho; // K = 1.0
  const Ld = (L * 1000) / d, uK = K / CONC.Klim, uD = Ld / lim;
  return {
    ok: uK <= 1 && uD <= 1, util: Math.max(uK, uD), b: 1000, h, size: `${h} mm C25/30 slab`, steps: [
      `Loads on a 1 m wide strip, d = h − ${CONC.cover} = ${d} mm:`,
      `  dead G = ${CONC.unitKN} kN/m³ × ${h / 1000} m + finishes ${FINISH.concrete} = ${f(G, 3)} kN/m²`,
      `  imposed Q = ${Q} kN/m²`,
      `Strength (ULS): q_d = 1.35·G + 1.5·Q = 1.35 × ${f(G, 3)} + 1.5 × ${Q} = ${f(qd, 3)} kN/m`,
      `  M = q_d·L²/8 = ${f(qd, 3)} × ${f(L)}² / 8 = ${f(M, 3)} kNm/m`,
      `  K = M/(b·d²·f_ck) = ${f(M * 1e6, 0)} / (1000 × ${d}² × ${CONC.fck}) = ${f(K, 4)} ${uK <= 1 ? "≤" : ">"} ${CONC.Klim} → ${uK <= 1 ? "no compression steel needed" : "TOO THIN: the concrete crushes first"}`,
      `  z = d·(0.5 + √(0.25 − K/1.134)) ≤ 0.95d → ${f(z, 1)} mm`,
      `  A_s = M/(f_yd·z) = ${f(M * 1e6, 0)} / (${f(fyd, 1)} × ${f(z, 1)}) = ${f(AsReq, 0)} mm²/m (min ${f(AsMin, 0)}) → use ${f(As, 0)} mm²/m`,
      `Deflection by span/depth (EN 1992-1-1 eq. 7.16, simply supported K = 1.0):`,
      `  ρ = A_s/(b·d) = ${f(rho * 100, 3)} %, ρ0 = √f_ck × 10⁻³ = ${f(rho0 * 100, 1)} %`,
      `  allowed L/d = ${f(lim, 1)}, actual L/d = ${f(L * 1000, 0)} / ${d} = ${f(Ld, 1)} → ${uD <= 1 ? "OK" : "FAILS: too thin for this span"} (${f(uD * 100, 0)} % used)`,
    ],
  };
}

/** The smallest standard section that passes, or null when none does. */
export function smallest(type: FloorType, L: number, s: number): Check | null {
  if (type === "timber") { for (const [b, h] of TIMBER_SIZES) { const c = timberCheck(L, s, b, h); if (c.ok) return c; } return null; }
  for (const h of SLAB_SIZES) { const c = slabCheck(L, h); if (c.ok) return c; }
  return null;
}

/** A modelled slab the coach checks: one standing on walls (bottom above ground). Span = shorter side less one wall thickness
 *  (centre to centre of the shell walls). shortcut: interior walls are not treated as supports; add that if he asks. */
export const spanOf = (p: Part) => Math.max(0.5, Math.min(p.w, p.d) - RULES.wallThick);
export const suspended = (parts: Part[]) => parts.filter((p) => p.kind === "slab" && p.y > 0.05);
export type CoachRow = { part: Part; span: number; now: Check; best: Check | null };
/** Each suspended slab: the modelled depth checked as is (timber: joists as deep as the slab block, as wide as the coach's pick
 *  or 45 mm), and the smallest standard section. */
export function coach(parts: Part[], type: FloorType, s: number): CoachRow[] {
  return suspended(parts).map((p) => {
    const span = spanOf(p), best = smallest(type, span, s), h = Math.round(p.h * 1000);
    return { part: p, span, now: type === "timber" ? timberCheck(span, s, best?.b ?? 45, h) : slabCheck(span, h), best };
  });
}
