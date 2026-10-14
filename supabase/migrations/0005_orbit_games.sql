-- ORBIT Game Lab: one row per user per game, holding the save and that game's settings.
-- Validated by the API before writing; RLS keeps every row private to its owner.

create table public.game_saves (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9-]{1,40}$'),
  save jsonb,                 -- versioned save file (null = no save / after reset)
  settings jsonb,             -- validated gameplay parameters (null = defaults)
  updated_at timestamptz not null default now(),
  primary key (user_id, game),
  check (save is null or pg_column_size(save) < 262144),
  check (settings is null or pg_column_size(settings) < 16384)
);

alter table public.game_saves enable row level security;
create policy "own game saves" on public.game_saves for all using (user_id = auth.uid()) with check (user_id = auth.uid());
