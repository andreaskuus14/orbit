"use client";
// Small shared pieces of VAULT (VaultPlanet + VaultFileSheet): the file type, URLs, the JSON fetch and the inline "Sure?" button.
import { useEffect, useState } from "react";
import { Button } from "./ui";
import type { CloudFile } from "@/lib/vault-pure";
import type { Coverage, SyncState } from "@/lib/vault-meta-pure";

export type VFile = CloudFile & { id?: string; version?: number; hash?: string | null; sync?: SyncState; lastSync?: number | null; syncError?: string | null; cov?: Coverage | null };
export const rawUrl = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;
export const thumbUrl = (f: { name: string; mtime: number }, w: 96 | 640) => `/api/vault?file=${encodeURIComponent(f.name)}&thumb=${w}&v=${Math.round(f.mtime)}`;

export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

/** A delete that can't be undone: the first click asks right there ("Sure?"), the second does it. No browser dialog. */
export function Confirm({ label, sure, onYes, size: s = "sm" }: { label: string; sure: string; onYes: () => void; size?: "sm" | "md" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const id = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(id); }, [armed]);
  return <Button size={s} variant={armed ? "danger" : "ghost"} onClick={() => (armed ? (setArmed(false), onYes()) : setArmed(true))} aria-live="polite">{armed ? sure : label}</Button>;
}
