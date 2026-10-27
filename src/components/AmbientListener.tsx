"use client";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { frameAmbient } from "./spatial-audio";

/** Inside the galaxy Canvas: listener = camera, panners = planets, every frame (no allocations). */
export function AmbientListener({ positions }: { positions: Readonly<Record<string, THREE.Vector3>> }) {
  useFrame(({ camera }) => frameAmbient(camera, positions));
  return null;
}
