-- Bounded ANALYTICS totals. RLS still applies; the explicit owner predicate also scopes every group.
create or replace function public.usage_totals(p_days integer default 7)
returns table (model text, purpose text, calls bigint, input_tokens bigint, output_tokens bigint)
language sql stable security invoker set search_path = public as $$
  select u.model, u.purpose, count(*), sum(u.input_tokens), sum(u.output_tokens)
  from public.usage u
  where u.user_id = auth.uid()
    and p_days in (7, 30)
    and u.created_at >= now() - make_interval(days => p_days)
    and u.created_at <= now()
  group by u.model, u.purpose
  order by u.model, u.purpose;
$$;
