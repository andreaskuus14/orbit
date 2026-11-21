import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "./activity";
import { emit } from "./claude";
import { cloudMove, cloudOnlyNames, renameFile, VaultError } from "./vault";
import { undoOp } from "./core-operator";
import { undoKey, type ActUndo } from "./activity-pure";

// One Undo for a logged autonomous action, shared by OPERATIONS → Activity (/api/activity) and the Time machine (/api/time-machine).
// Memory and VAULT-rename undos (and every time-machine record) leave a time-machine record, so they can be undone again (redo).
// op / pc / term keep their own before-state elsewhere and undo once.
export async function undoActivity(sb: SupabaseClient, userId: string, u: ActUndo, rawArea: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const area = rawArea === "core" || rawArea === "system" ? rawArea : "operator"; // same area as the original line, so the filter hides its Undo
  try {
    if (u.kind === "tm") {
      const r = await (await import("./time-machine")).undoRecord(sb, userId, u.id);
      if (!r.ok) return { status: r.status, body: { error: r.error } };
      logActivity({ area, title: r.title, undid: undoKey(u), undo: { kind: "tm", id: r.id } });
      return { status: 200, body: { ok: true, tm: r.id } };
    }
    if (u.kind === "memory") {
      const kept = await (await import("./time-machine")).undoSavedMemory(sb, userId, u.id);
      if (kept) {
        await emit(sb, userId, "memory.deleted", "memory", { id: u.id });
        logActivity({ area, title: kept.title, undid: undoKey(u), undo: { kind: "tm", id: kept.id } });
        return { status: 200, body: { ok: true, tm: kept.id } };
      }
      const { data, error } = await sb.from("memories").delete().eq("id", u.id).select("id, storage_path");
      if (error) return { status: 400, body: { error: error.message } };
      if (!data?.length) return { status: 404, body: { error: "Already gone" } };
      if (data[0].storage_path) await sb.storage.from("vault").remove([data[0].storage_path]).then(({ error: e }) => e && console.error("[orbit] undo: memory deleted but its file was not", e));
      await emit(sb, userId, "memory.deleted", "memory", { id: u.id });
      logActivity({ area, title: "Undone: memory deleted", undid: undoKey(u) });
    } else if (u.kind === "pc") { // a level-2 PC action (move/rename/code edit) through the voice helper
      logActivity({ area, title: await (await import("./jarvis")).undoPc(u.id), undid: undoKey(u) });
    } else if (u.kind === "term") { // a terminal command's snapshot (OPERATIONS → Terminal)
      logActivity({ area, title: await (await import("./shell-session")).undoSnapshot(u.id), undid: undoKey(u) });
    } else if (u.kind === "op") { // ORGANIZE write (vault_move/rename, lead_update, life_plan, automation_create/pause): its saved before-state
      logActivity({ area, title: await undoOp(sb, userId, u.id), undid: undoKey(u) });
    } else {
      const name = await renameFile(u.id, u.to, await cloudOnlyNames(sb, userId));
      const cloud = name === u.id ? "ok" : await cloudMove(sb, userId, u.id, name);
      const title = `Undone: VAULT "${u.id}" renamed back to "${name}"`;
      const tm = name === u.id ? null : await (await import("./time-machine")).recordTm({ title, changes: [{ t: "vault", before: { name: u.id }, after: { name } }] });
      logActivity({ area, title, undid: undoKey(u), ...(tm ? { undo: { kind: "tm" as const, id: tm } } : {}) });
      return { status: 200, body: { ok: true, name, cloud } };
    }
    return { status: 200, body: { ok: true } };
  } catch (e) {
    if (e instanceof VaultError) return { status: e.status, body: { error: e.message } };
    return { status: 500, body: { error: e instanceof Error ? e.message : "Undo failed" } };
  }
}
