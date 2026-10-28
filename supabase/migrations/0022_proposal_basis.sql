-- Roadmap 23: the exact artifact revisions a proposal was based on, [{ref, rev}] (src/lib/artifact-rev-pure.ts). Approving re-checks
-- them and refuses with an explanation when an artifact changed since. Additive and idempotent; code tolerates the column's absence.
alter table public.proposals add column if not exists basis jsonb not null default '[]'::jsonb;
