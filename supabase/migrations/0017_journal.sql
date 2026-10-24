-- "Today in a minute" (evening capture): journal memories, and beliefs learned from them. Idempotent; drops no data. Run after 0012.

-- 1. memories.kind accepts 'journal' (0001's inline check is named memories_kind_check).
alter table public.memories drop constraint if exists memories_kind_check;
alter table public.memories add constraint memories_kind_check check (kind in
  ('note','idea','link','document','image','research','conversation','project','preference','decision','goal','journal'));

-- 2. write_memory_fact from 0012, unchanged except in 'learn': the source may also be the owner's own evening entry
--    (memories kind 'journal', source 'evening', written only by POST /api/evening) instead of a chat message.
--    The fact must still appear verbatim in that text, and source_ref keeps the entry's id.
create or replace function public.write_memory_fact(
  p_action text, p_subject text default null, p_statement text default null,
  p_source_ref uuid default null, p_confidence real default 1, p_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_at timestamptz := clock_timestamp();
  v_subject text;
  v_statement text;
  v_source_ref uuid;
  v_confidence real;
  v_source_text text;
  v_source_at timestamptz;
  v_target public.memory_facts;
  v_current public.memory_facts;
  v_latest public.memory_facts;
  v_new public.memory_facts;
  v_previous uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_action not in ('learn', 'edit', 'wrong', 'restore') or p_action is null then
    raise exception 'Unknown fact action' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if p_action <> 'learn' then
    select * into v_target from public.memory_facts where user_id = v_user and id = p_id for update;
    if not found then raise exception 'Belief not found' using errcode = 'PT409'; end if;
  end if;
  if p_action = 'wrong' then
    update public.memory_facts set status = 'retracted' where user_id = v_user and id = p_id returning * into v_new;
    return jsonb_build_object('fact', to_jsonb(v_new), 'changed', true);
  end if;
  if p_action = 'restore' and v_target.status = 'current' then
    return jsonb_build_object('fact', to_jsonb(v_target), 'changed', false);
  end if;
  if p_action = 'edit' and v_target.status <> 'current' then
    raise exception 'That belief changed meanwhile; reload and try again' using errcode = 'PT409';
  end if;
  if p_action = 'restore' then
    v_subject := v_target.subject; v_statement := v_target.statement;
    -- The click is a new owner endorsement. Retain the original user-message reference when available.
    v_source_ref := case when v_target.source = 'user_said' then v_target.source_ref else null end;
    v_confidence := 1;
  else
    v_subject := lower(regexp_replace(btrim(p_subject), '\s+', ' ', 'g'));
    v_statement := regexp_replace(btrim(p_statement), '\s+', ' ', 'g');
    v_confidence := p_confidence;
    if p_action = 'learn' then
      select content, created_at into v_source_text, v_source_at from public.messages where user_id = v_user and id = p_source_ref and role = 'user';
      if not found then
        select content, created_at into v_source_text, v_source_at from public.memories
          where user_id = v_user and id = p_source_ref and kind = 'journal' and source = 'evening';
        if not found then raise exception 'Only an owner message can supply a learned fact' using errcode = '42501'; end if;
      end if;
      if position(lower(v_statement) in lower(regexp_replace(v_source_text, '\s+', ' ', 'g'))) = 0 then
        raise exception 'Fact must come from the owner message' using errcode = '22023';
      end if;
      v_source_ref := p_source_ref; v_at := v_source_at;
    end if;
  end if;
  if v_subject is null or char_length(v_subject) not between 2 and 60
    or v_statement is null or char_length(v_statement) not between 3 and 300
    or v_confidence is null or v_confidence not between 0 and 1 then
    raise exception 'Invalid fact' using errcode = '22023';
  end if;
  select * into v_current from public.memory_facts where user_id = v_user and status = 'current'
    and lower(regexp_replace(btrim(subject), '\s+', ' ', 'g')) = v_subject
    order by created_at desc, id desc limit 1 for update;
  if p_action = 'learn' then
    select * into v_latest from public.memory_facts where user_id = v_user
      and lower(regexp_replace(btrim(subject), '\s+', ' ', 'g')) = v_subject
      order by greatest(created_at, case when status = 'retracted' then updated_at else created_at end) desc, id desc limit 1;
    -- Do not resurrect an older turn after the owner has marked that subject wrong.
    if v_latest.id is not null and greatest(v_latest.created_at,
      case when v_latest.status = 'retracted' then v_latest.updated_at else v_latest.created_at end) > v_at then
      return jsonb_build_object('fact', to_jsonb(v_latest), 'changed', false);
    end if;
  end if;
  -- A slower, older chat turn cannot overwrite a newer statement or owner correction.
  if p_action = 'learn' and v_current.id is not null and (
    v_current.created_at > v_at or lower(v_current.statement) = lower(v_statement)
  ) then return jsonb_build_object('fact', to_jsonb(v_current), 'changed', false); end if;
  v_previous := case when p_action = 'edit' then v_target.id else v_current.id end;
  update public.memory_facts set status = 'superseded', superseded_by = v_id, superseded_at = v_at
    where user_id = v_user and status = 'current' and (
      lower(regexp_replace(btrim(subject), '\s+', ' ', 'g')) = v_subject or (p_action = 'edit' and id = p_id)
    );
  insert into public.memory_facts (id, user_id, subject, statement, source, source_ref, confidence, supersedes, restored_from, created_at)
    values (v_id, v_user, v_subject, v_statement, 'user_said', v_source_ref, v_confidence,
      v_previous, case when p_action = 'restore' then p_id else null end, v_at) returning * into v_new;
  return jsonb_build_object('fact', to_jsonb(v_new), 'changed', true);
end;
$$;
revoke all on function public.write_memory_fact(text, text, text, uuid, real, uuid) from public, anon;
grant execute on function public.write_memory_fact(text, text, text, uuid, real, uuid) to authenticated;
