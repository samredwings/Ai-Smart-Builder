drop policy if exists "insert own device app data" on public.app_data;
drop policy if exists "read own device app data" on public.app_data;
drop policy if exists "update own device app data" on public.app_data;
revoke select, insert, update on public.app_data from anon;
create policy "owners read app data" on public.app_data for select to authenticated
  using (exists (select 1 from public.projects p where p.id = app_data.project_id and p.owner_id = auth.uid()));
comment on table public.app_data is 'Published-app data is only written through server code (service role); visitors have no direct access.';