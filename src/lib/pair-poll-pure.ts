// Client-safe (remote-pure.ts imports node:crypto). Used by PhonePairing.tsx; tested in tests/remote-revoke.test.ts.
/** The PC re-reads the pairing while a live code shows, so "locked" appears without a reload; and once the code has expired. */
export const PAIR_POLL_MS = 3000;
export const pairRefetch = (pair: { code?: string; locked?: true; expiresAt: number } | null | undefined, now: number, lastFetch: number) =>
  !!pair && (now >= pair.expiresAt || (!!pair.code && now - lastFetch >= PAIR_POLL_MS));
