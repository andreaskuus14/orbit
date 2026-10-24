-- "Today in a minute" (evening capture): memories.kind accepts 'journal'. Idempotent; drops no data.
-- Journal entries are LIFE data: no beliefs are learned from them, and CORE/agents memory search skips them.
-- 0001's inline check is named memories_kind_check.
alter table public.memories drop constraint if exists memories_kind_check;
alter table public.memories add constraint memories_kind_check check (kind in
  ('note','idea','link','document','image','research','conversation','project','preference','decision','goal','journal'));
