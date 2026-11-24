// One GET /api/markets/deals for everyone on screen: ContractsPanel (great deals → purchase agreement) and DealCards (the
// wishlist) mount together in BUSINESS → Clients. Calls made while one is in flight share it.
let inflight: Promise<unknown> | null = null;
export function getDeals<T>(): Promise<T> {
  if (!inflight) {
    inflight = fetch("/api/markets/deals", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
      return j;
    }).finally(() => { setTimeout(() => { inflight = null; }, 0); });
  }
  return inflight as Promise<T>;
}
