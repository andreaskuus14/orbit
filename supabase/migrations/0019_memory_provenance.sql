-- Memory provenance (src/lib/provenance-pure.ts): every memory and belief carries where it came from (source + source_ref,
-- created_at already exists), whether the owner confirmed it, and an optional recheck date for facts that change.
-- 'suggested' records (anything ORBIT inferred) never become commitments on their own; only the owner's click confirms.
-- Idempotent; drops no data. Existing rows count as confirmed: they were saved by the owner or by existing owner flows.
alter table public.memories add column if not exists source_ref text;
alter table public.memories add column if not exists confirmation text not null default 'confirmed';
alter table public.memories add column if not exists recheck_at timestamptz;
alter table public.memories drop constraint if exists memories_confirmation_check;
alter table public.memories add constraint memories_confirmation_check check (confirmation in ('suggested','confirmed'));

alter table public.memory_facts add column if not exists confirmation text not null default 'confirmed';
alter table public.memory_facts add column if not exists recheck_at timestamptz;
alter table public.memory_facts drop constraint if exists memory_facts_confirmation_check;
alter table public.memory_facts add constraint memory_facts_confirmation_check check (confirmation in ('suggested','confirmed'));

create index if not exists memories_user_recheck on public.memories (user_id, recheck_at) where recheck_at is not null;
