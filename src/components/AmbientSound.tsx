"use client";
// React glue for the spatial ambient sound (spatial-audio.ts): the camera-following listener inside the galaxy Canvas,
// the app-wide lifecycle, and the HUD menu controls.
import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { ambientEnabled, ambientVolume, applyMix, frameAmbient, resumeAmbient, setAmbient, setAmbientVolume } from "./spatial-audio";

/** Inside the galaxy Canvas: listener = camera, panners = planets, every frame (no allocations). */
export function AmbientListener({ positions }: { positions: Readonly<Record<string, THREE.Vector3>> }) {
  useFrame(({ camera }) => frameAmbient(camera, positions));
  return null;
}

/** Once in the app: start on the first gesture (browsers block audio before one), silence hidden tabs, re-check quiet hours. */
export function AmbientSound() {
  useEffect(() => {
    addEventListener("pointerdown", resumeAmbient); addEventListener("keydown", resumeAmbient);
    document.addEventListener("visibilitychange", applyMix);
    const t = setInterval(applyMix, 60_000);
    return () => {
      removeEventListener("pointerdown", resumeAmbient); removeEventListener("keydown", resumeAmbient);
      document.removeEventListener("visibilitychange", applyMix); clearInterval(t);
    };
  }, []);
  return null;
}

export function AmbientSoundMenu() {
  const [on, setOn] = useState(false), [vol, setVol] = useState(0.5);
  useEffect(() => { setOn(ambientEnabled()); setVol(ambientVolume()); }, []);
  return (
    <div className="hud-menu-group" role="group" aria-label="Ambient sound">
      <button className="hud-menu-item" aria-pressed={on} onClick={() => { setAmbient(!on); setOn(!on); }}
        title="Each planet hums from where it is; real events chime from their planet. Quieter 23:00–08:00.">Ambient sound: {on ? "on" : "off"}</button>
      {on && <input type="range" min={0} max={1} step={0.05} value={vol} aria-label="Ambient volume"
        onChange={(e) => { const v = Number(e.target.value); setVol(v); setAmbientVolume(v); }} />}
    </div>
  );
}
