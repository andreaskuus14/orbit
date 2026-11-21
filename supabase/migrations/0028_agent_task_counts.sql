-- /api/agents: grouped task counts instead of every task row every 5 s (efficiency pass 2, src/lib/agent-counts-pure.ts).
-- A team's parent row ("Team: ...") isn't the agent working, same as the old in-route filter. RLS still applies; the explicit
-- owner predicate scopes every group.
create or replace function public.agent_task_counts()
returns table (agent text, status text, n bigint)
language sql stable security invoker set search_path = public as $$
  select t.agent, t.status, count(*)
  from public.tasks t
  where t.user_id = auth.uid()
    and coalesce(t.title, '') not like 'Team: %'
  group by t.agent, t.status
  order by t.agent, t.status;
$$;
