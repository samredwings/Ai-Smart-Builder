create table public.workspace_settings (
  user_id uuid primary key,
  sheet_id text,
  git_repo_url text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.workspace_settings to authenticated;
grant all on public.workspace_settings to service_role;
alter table public.workspace_settings enable row level security;
create policy "own settings" on public.workspace_settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger workspace_settings_touch before update on public.workspace_settings
  for each row execute function public.touch_updated_at();

drop policy if exists "insert own device app data" on public.app_data;
drop policy if exists "read own device app data" on public.app_data;
drop policy if exists "update own device app data" on public.app_data;
revoke all on public.app_data from anon;
comment on table public.app_data is 'DEPRECATED: published App Forge apps were removed; no client access.';