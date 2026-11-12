-- Where a prospect came from, on the row itself. "lead-loop" (B2) leads are never sent by Auto (autonomy.ts autoExcluded), only by
-- the owner's own Approve & send. Until this runs, Auto's select of this column fails, so Auto sends nothing (fail closed).
alter table public.prospects add column if not exists source text check (source is null or char_length(source) <= 40);
