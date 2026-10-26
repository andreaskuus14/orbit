-- Episodic memory (src/lib/episodes-pure.ts): memories.kind accepts 'episode'. Idempotent; drops no data.
-- Episodes are built nightly from ORBIT's own records (calls, decisions, wins, setbacks, milestones); never from journal text.
alter table public.memories drop constraint if exists memories_kind_check;
alter table public.memories add constraint memories_kind_check check (kind in
  ('note','idea','link','document','image','research','conversation','project','preference','decision','goal','journal','episode'));
