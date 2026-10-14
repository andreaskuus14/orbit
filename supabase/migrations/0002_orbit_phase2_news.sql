-- ORBIT Phase 2: news feeds, articles, Pulse briefings, background job log. Owner-only RLS on everything.

create table public.feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~* '^https?://'),
  title text,
  topic text,                       -- set when the feed came from a topic search
  enabled boolean not null default true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feed_id uuid references public.feeds (id) on delete set null,
  url text not null,                -- normalized (tracking params removed) for de-duplication
  title text not null,
  source text,
  summary text not null default '',
  topic text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (user_id, url)
);
create index articles_user_published on public.articles (user_id, published_at desc nulls last);

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('morning','midday','evening','weekly','manual')),
  title text not null,
  content text not null,
  citations jsonb not null default '[]',
  article_count int not null default 0,
  memory_id uuid references public.memories (id) on delete set null,
  created_at timestamptz not null default now()
);
create index briefings_user_created on public.briefings (user_id, created_at desc);

create table public.job_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job text not null,
  status text not null check (status in ('running','ok','failed')),
  detail text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_runs_user_started on public.job_runs (user_id, started_at desc);

alter table public.feeds enable row level security;
alter table public.articles enable row level security;
alter table public.briefings enable row level security;
alter table public.job_runs enable row level security;

create policy "own feeds" on public.feeds for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own articles" on public.articles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own briefings" on public.briefings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own job runs" on public.job_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
