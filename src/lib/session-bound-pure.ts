// Session boundaries for CORE chats (roadmap B04/B05): one turn per chat at a time, client retries deduped, a hard turn deadline.

/** Per-key FIFO: fn for a key starts only after the previous one for that key settled. Other keys run in parallel. */
export function chatQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const p = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = p.then(() => {}, () => {});
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return p;
  };
}

/** Same id → same promise (an accidental client retry gets the first answer, not a second turn). A failure is forgotten so a
 *  retry runs again; null id = never deduped. Keeps the newest `max` ids. */
export function onceById<T>(max = 200) {
  const seen = new Map<string, Promise<T>>();
  return (id: string | null, fn: () => Promise<T>): Promise<T> => {
    if (!id) return fn();
    const hit = seen.get(id);
    if (hit) return hit;
    const p = fn();
    seen.set(id, p);
    p.catch(() => { if (seen.get(id) === p) seen.delete(id); });
    if (seen.size > max) seen.delete(seen.keys().next().value!);
    return p;
  };
}

/** The turn's signal: the caller's abort or the elapsed-time deadline, whichever comes first. clear() when the turn ends. */
export function turnSignal(caller: AbortSignal | undefined, ms: number) {
  const ac = new AbortController();
  let late = false;
  const timer = setTimeout(() => { late = true; ac.abort(new DOMException(`CORE turn time limit (${Math.round(ms / 1000)} s) reached`, "TimeoutError")); }, ms);
  const follow = () => ac.abort(caller?.reason);
  if (caller?.aborted) follow(); else caller?.addEventListener("abort", follow, { once: true });
  return { signal: ac.signal, timedOut: () => late, clear: () => { clearTimeout(timer); caller?.removeEventListener("abort", follow); } };
}
