-- When the saved draft was written. Auto (AGENTS.md rule 6) sends only drafts made after it was switched on, and compares this
-- stamp, not updated_at, so a note or stage edit doesn't make an old draft new. Null (drafts before this migration) = never auto.
alter table public.prospects add column if not exists drafted_at timestamptz;
