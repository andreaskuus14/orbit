-- Where a task came from, when that isn't the owner: "scorecard" = an ANALYTICS replay case (agent-replay.ts). "Continue my work"
-- leaves those out; ANALYTICS keeps showing them. Null = his own task (every row before this migration). Existing scorecard rows
-- are not rewritten here: the inbox recognises them by their exact case (agent, title and request), so history stays untouched.
alter table public.tasks add column if not exists origin text;
