"use client";
import { createContext, useContext } from "react";

/** True inside a world that Orbit keeps mounted but hidden (visited before, not on screen): polls and global keys stand down. */
export const WorldPaused = createContext(false);
export const useWorldPaused = () => useContext(WorldPaused);
