-- ORBIT BUSINESS: the outreach angle a first draft used (speed | missed-leads | free-pilot), for reply rates per angle.
-- The app works without it (drafts are then saved untagged).
alter table public.prospects add column if not exists template text check (template is null or char_length(template) <= 40);
