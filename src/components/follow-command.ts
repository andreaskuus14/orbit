import { followAck, followReply, parseFollowCommand } from "@/lib/follows-pure";

export const FOLLOWS_EVENT = "orbit:follows"; // the followed topics changed: Intelligence and the globe reload

/** "follow <topic>" / "unfollow <topic>": saves it in the background and returns an immediate "Following X…"
 *  acknowledgement; onDone gets the real outcome (or the server's error). Null if the text isn't a follow command
 *  (then it goes on to navigation or CORE as before). */
export function runFollowCommand(text: string, onDone?: (msg: string, ok: boolean) => void): string | null {
  const cmd = parseFollowCommand(text);
  if (!cmd) return null;
  const req = cmd.action === "follow"
    ? fetch("/api/news/follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: cmd.topic }) })
    : fetch(`/api/news/follows?topic=${encodeURIComponent(cmd.topic)}`, { method: "DELETE" });
  req.then(async (res) => {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Couldn't ${cmd.action} ${cmd.topic} (${res.status})`);
    dispatchEvent(new Event(FOLLOWS_EVENT));
    onDone?.(followReply(cmd, json.removed !== false), true);
  }).catch((e) => onDone?.(e instanceof Error ? e.message : `Couldn't ${cmd.action} ${cmd.topic}`, false));
  return followAck(cmd);
}
