-- Entity-keyed beliefs (src/lib/entity-memory-pure.ts). Apply after 0012_fact_history.sql. Idempotent; drops no data.
-- entity_id: which person, company, project or game a belief is about ("person:<PEOPLE id>", "prospect:<BUSINESS id>",
-- "project:<name>"); null = the owner himself. Until this is applied ORBIT works it out from the subject on every read.
-- valid_from / valid_until: the belief's validity window, derived from the history memory_facts already keeps (no second store):
-- valid from creation until the newer belief that superseded it (superseded_at) or until he marked it wrong. Current = null.
alter table public.memory_facts add column if not exists entity_id text;
alter table public.memory_facts drop constraint if exists memory_facts_entity_id_check;
alter table public.memory_facts add constraint memory_facts_entity_id_check check (entity_id is null or char_length(entity_id) between 2 and 120);
alter table public.memory_facts add column if not exists valid_from timestamptz generated always as (created_at) stored;
alter table public.memory_facts add column if not exists valid_until timestamptz generated always as (
  case when status = 'superseded' then coalesce(superseded_at, updated_at) when status = 'retracted' then updated_at end
) stored;
create index if not exists memory_facts_user_entity on public.memory_facts (user_id, entity_id, valid_from desc) where entity_id is not null;
