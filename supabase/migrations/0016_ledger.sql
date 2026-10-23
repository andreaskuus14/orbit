-- Event ledger: public.events becomes ORBIT's append-only ledger (src/lib/ledger-pure.ts). Idempotent; drops nothing.
-- caused_by links an event to the one that led to it. events.id is bigint (0001), so the link is bigint too.
-- RLS is unchanged: "read own events" / "insert own events" from 0001 (owner-only).

alter table public.events add column if not exists caused_by bigint null references public.events (id) on delete set null;
create index if not exists events_user_created on public.events (user_id, created_at desc);
create index if not exists events_caused_by on public.events (caused_by) where caused_by is not null;
