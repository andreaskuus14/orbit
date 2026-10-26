"use client";
// Real sky (Roadmap 3): the galaxy's backdrop follows the real sky at his place. Once a minute it sets values the galaxy
// already has (background + fog colour, a directional light's colour/intensity/direction, a sprite texture): no new shader
// program and nothing animates, so reduced motion sees the same calm minute steps. The moon reuses the lightning flash's
// sprite program (same SpriteMaterial settings). Off restores Galaxy's own colours.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { realSky, starDensity, SKY_BG, SKY_FOG, SKY_HOME, type RealSky as Sky } from "@/lib/real-sky-pure";
import { useRealSkyOn } from "./real-sky-toggle";

const MOON_R = 90, MOON_SIZE = 3; // inside drei <Stars radius={110}>, ~2° across
const starsAt = (lat: number, lon: number) => Math.round(starDensity(lat, lon, new Date()) * 20) / 20;

/** Toggle, place (the saved "my PC is here" place when the place feature exists, else Tallinn) and the star-count factor. */
export function useRealSkyPlace() {
  const on = useRealSkyOn();
  const [place, setPlace] = useState(SKY_HOME);
  const [stars, setStars] = useState(() => starsAt(SKY_HOME.lat, SKY_HOME.lon));
  useEffect(() => {
    if (!on) return;
    let alive = true;
    // well after start-up; a 404 (no place feature) or no PC place keeps Tallinn
    const t = setTimeout(() => fetch("/api/place").then((r) => (r.ok ? r.json() : null)).then((d: { places?: { lat: number; lon: number; pc?: boolean }[] } | null) => {
      const pc = d?.places?.find((p) => p.pc);
      if (alive && pc && Number.isFinite(pc.lat) && Number.isFinite(pc.lon)) setPlace({ lat: pc.lat, lon: pc.lon });
    }).catch(() => {}), 15_000);
    return () => { alive = false; clearTimeout(t); };
  }, [on]);
  useEffect(() => { // the season moves slowly: hourly is plenty, and the state only changes in 0.05 steps
    const f = () => setStars(starsAt(place.lat, place.lon));
    f();
    const t = setInterval(f, 3_600_000);
    return () => clearInterval(t);
  }, [place]);
  return { on, ...place, stars: on ? stars : 1 };
}

/** The lit part of the disc as the northern hemisphere sees it (waxing: lit on the right). Additive: black is invisible. */
function paintMoon(c: HTMLCanvasElement, k: number, waxing: boolean) {
  const g = c.getContext("2d")!, r = 28;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, 64, 64);
  g.translate(32, 32);
  if (!waxing) g.scale(-1, 1);
  g.fillStyle = "rgba(244,239,228,0.05)"; // earthshine: a thin crescent still reads as a moon
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f4efe4";
  g.beginPath();
  g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); // the lit half
  g.ellipse(0, 0, r * Math.abs(2 * k - 1), r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5); // terminator: crescent cuts in, gibbous bulges out
  g.fill();
}

export function RealSky({ on, lat, lon }: { on: boolean; lat: number; lon: number }) {
  const scene = useThree((s) => s.scene);
  const light = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.Sprite>(null);
  const [{ tex, canvas }] = useState(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, canvas };
  });
  const moonDir = useRef(new THREE.Vector3(0, 1, 0));
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => { // a sky object sits at infinity: follow the camera exactly, in the frame it renders (no lag, no culling)
    const m = moon.current;
    if (!m) return;
    m.frustumCulled = false;
    m.onBeforeRender = (_r, _s, cam) => { m.position.copy(cam.position).addScaledVector(moonDir.current, MOON_R); m.updateMatrixWorld(); };
  }, []);
  useEffect(() => {
    let painted = -1, waxed: boolean | null = null;
    const apply = () => {
      const bg = scene.background as THREE.Color | null, fog = scene.fog as THREE.FogExp2 | null, l = light.current, m = moon.current;
      if (!on) {
        if (bg?.isColor) bg.set(SKY_BG);
        fog?.color.set(SKY_FOG);
        if (l) l.intensity = 0;
        if (m) m.visible = false;
        return;
      }
      const s: Sky = realSky(new Date(), lat, lon);
      if (bg?.isColor) bg.set(s.bg);
      fog?.color.set(s.fog);
      if (l) { l.intensity = s.sun.intensity; l.color.set(s.sun.color); l.position.set(s.sun.dir.x, s.sun.dir.y, s.sun.dir.z).multiplyScalar(10); }
      moonDir.current.set(s.moon.dir.x, s.moon.dir.y, s.moon.dir.z);
      if (m) m.visible = s.moon.up;
      if (Math.abs(s.moon.illumination - painted) > 0.005 || waxed !== s.moon.waxing) {
        paintMoon(canvas, s.moon.illumination, s.moon.waxing);
        tex.needsUpdate = true; painted = s.moon.illumination; waxed = s.moon.waxing;
      }
    };
    apply();
    if (!on) return;
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [on, lat, lon, scene, tex, canvas]);
  return (
    <>
      {/* always mounted, intensity 0 when off: adding or removing a light would recompile every lit program in the galaxy */}
      <directionalLight ref={light} intensity={0} />
      <sprite ref={moon} scale={MOON_SIZE} visible={false}>
        <spriteMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </>
  );
}
