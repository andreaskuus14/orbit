-- A little owner data so the re-run pass can prove no migration deletes or changes existing rows.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'owner@example.test');
insert into public.memories (user_id, kind, title, content)
  values ('00000000-0000-0000-0000-000000000001', 'note', 'seed', 'seed note');
insert into public.memories (user_id, kind, title, content)
  values ('00000000-0000-0000-0000-000000000001', 'episode', 'seed ep', 'seed episode');
insert into public.conversations (id, user_id, title)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', 'seed');
insert into public.messages (conversation_id, user_id, role, content)
  values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', 'user', 'I like tea');
insert into public.memory_facts (user_id, subject, statement, source)
  values ('00000000-0000-0000-0000-000000000001', 'drink', 'I like tea', 'user_said');
insert into public.tasks (user_id, agent, title, request) values ('00000000-0000-0000-0000-000000000001', 'core', 'seed task', 'seed');
insert into public.gpu_jobs (user_id, kind) values ('00000000-0000-0000-0000-000000000001', 'image');
