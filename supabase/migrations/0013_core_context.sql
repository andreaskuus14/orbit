-- Apply before deploying CORE's retained attachment context.
alter table public.messages add column if not exists attachment_text text not null default '';

-- Enforce the per-chat budget in the database as well as in the prompt. Lock the owning
-- conversation so simultaneous file uploads cannot each spend the same remaining budget.
create or replace function public.cap_chat_attachment_text()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  used_chars bigint;
begin
  if new.attachment_text = '' then return new; end if;
  if new.role <> 'user' then
    new.attachment_text := '';
    return new;
  end if;
  perform id from public.conversations
    where id = new.conversation_id and user_id = new.user_id and user_id = auth.uid()
    for update;
  if not found then raise exception 'Chat not found' using errcode = '42501'; end if;
  select coalesce(sum(char_length(attachment_text)), 0) into used_chars
    from public.messages where conversation_id = new.conversation_id and id <> new.id;
  new.attachment_text := left(new.attachment_text, greatest(0, 20000 - used_chars)::int);
  return new;
end;
$$;
create trigger messages_attachment_budget
  before insert or update of attachment_text, conversation_id, role on public.messages
  for each row execute function public.cap_chat_attachment_text();

-- Search summaries within their own candidate pool; ordinary memory hits cannot crowd
-- them out of the vector top-N. Same owner/RLS boundary as match_memories.
create or replace function public.match_core_summaries(
  query_embedding extensions.vector(1024), match_count int default 3
)
returns table (id uuid, title text, kind text, similarity float)
language sql stable security invoker set search_path = public, extensions as $$
  select m.id, m.title, m.kind, 1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.user_id = auth.uid() and m.kind = 'conversation' and m.source = 'core-summary'
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit least(greatest(match_count, 0), 50);
$$;
