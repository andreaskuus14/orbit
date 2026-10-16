-- ORBIT: VAULT planet cloud copies. Files stay on the PC; each one also gets a private copy in the existing 'vault'
-- storage bucket under <your user id>/vault-files/. Run once in the Supabase SQL Editor.

-- Allow files up to 50 MB (the Supabase free plan's per-file maximum). MEMORY uploads keep their own 4 MB limit in the app.
update storage.buckets set file_size_limit = 52428800 where id = 'vault';

-- Renaming a file in VAULT moves its cloud copy, which needs update rights on your own objects.
drop policy if exists "vault update own" on storage.objects; -- safe to run this file again
create policy "vault update own" on storage.objects for update
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
