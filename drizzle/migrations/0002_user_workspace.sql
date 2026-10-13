create table public.user_workspace (
  user_id uuid primary key,
  sheet_id text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_workspace to authenticated;
grant all on public.user_workspace to service_role;
alter table public.user_workspace enable row level security;
create policy "own workspace" on public.user_workspace for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger user_workspace_touch before update on public.user_workspace
  for each row execute function public.touch_updated_at();