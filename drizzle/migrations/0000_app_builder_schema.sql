create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  slug text not null unique,
  title text not null default 'Untitled app',
  prompt text not null default '',
  template_family text not null default 'utility',
  icon_url text,
  theme jsonb not null default '{"primary":"#4f46e5","background":"#ffffff","foreground":"#0f172a","accent":"#a78bfa"}'::jsonb,
  current_version_id uuid,
  is_published boolean not null default false,
  ai_runtime text not null default 'lovable' check (ai_runtime in ('lovable','remote','on-device')),
  ai_remote_endpoint text,
  ai_remote_model text,
  ai_ondevice_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
create policy "owners crud own projects" on public.projects for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index on public.projects(owner_id);
create trigger projects_touch_updated_at before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_num int not null,
  tabs jsonb not null,
  created_by_message text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.project_versions to authenticated;
grant all on public.project_versions to service_role;
alter table public.project_versions enable row level security;
create policy "owners crud own versions" on public.project_versions for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create index on public.project_versions(project_id);

create table public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  version_id_after uuid references public.project_versions(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.project_messages to authenticated;
grant all on public.project_messages to service_role;
alter table public.project_messages enable row level security;
create policy "owners crud own messages" on public.project_messages for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create index on public.project_messages(project_id);

create schema if not exists app_private;
grant usage on schema app_private to anon, authenticated;
create or replace function app_private.is_project_published(_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = _project_id and p.is_published = true);
$$;
revoke all on function app_private.is_project_published(uuid) from public;
grant execute on function app_private.is_project_published(uuid) to anon, authenticated;

create table public.app_data (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_key text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  unique (project_id, device_key, key)
);
grant select, insert, update on public.app_data to anon;
grant select, insert, update, delete on public.app_data to authenticated;
grant all on public.app_data to service_role;
alter table public.app_data enable row level security;
create policy "insert own device app data" on public.app_data for insert to anon, authenticated
  with check (device_key = ((current_setting('request.headers', true))::json ->> 'x-device-key') and app_private.is_project_published(project_id));
create policy "read own device app data" on public.app_data for select to anon, authenticated
  using (device_key = ((current_setting('request.headers', true))::json ->> 'x-device-key') and app_private.is_project_published(project_id));
create policy "update own device app data" on public.app_data for update to anon, authenticated
  using (device_key = ((current_setting('request.headers', true))::json ->> 'x-device-key') and app_private.is_project_published(project_id))
  with check (device_key = ((current_setting('request.headers', true))::json ->> 'x-device-key') and app_private.is_project_published(project_id));
create policy "owners delete app data" on public.app_data for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = app_data.project_id and p.owner_id = auth.uid()));
create index on public.app_data(project_id, device_key);
create trigger app_data_touch_updated_at before update on public.app_data
  for each row execute function public.touch_updated_at();

create table public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  latency_ms integer not null,
  success boolean not null,
  error_message text,
  token_count integer,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select on public.ai_logs to authenticated;
grant all on public.ai_logs to service_role;
alter table public.ai_logs enable row level security;
create policy "owners view own ai logs" on public.ai_logs for select to authenticated
  using (project_id is not null and exists (select 1 from public.projects p where p.id = ai_logs.project_id and p.owner_id = auth.uid()));
create index on public.ai_logs(created_at desc);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  text text not null,
  source text not null default 'added' check (source in ('original','added','changed','manual')),
  status text not null default 'planned' check (status in ('planned','done','changed','removed')),
  position integer not null default 0,
  version_first_seen integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.requirements to authenticated;
grant all on public.requirements to service_role;
alter table public.requirements enable row level security;
create policy "owners manage requirements" on public.requirements for all to authenticated
  using (exists (select 1 from public.projects p where p.id = requirements.project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = requirements.project_id and p.owner_id = auth.uid()));
create index on public.requirements(project_id, position);
create trigger requirements_touch before update on public.requirements
  for each row execute function public.touch_updated_at();

create table public.test_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid references public.project_versions(id) on delete set null,
  kind text not null check (kind in ('static','behavioral')),
  passed boolean not null,
  issue_count integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.test_results to authenticated;
grant all on public.test_results to service_role;
alter table public.test_results enable row level security;
create policy "owners read test_results" on public.test_results for select to authenticated
  using (exists (select 1 from public.projects p where p.id = test_results.project_id and p.owner_id = auth.uid()));
create index on public.test_results(project_id, created_at desc);

create policy "auth users upload own app icons" on storage.objects for insert to authenticated
  with check (bucket_id = 'app-icons' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "auth users update own app icons" on storage.objects for update to authenticated
  using (bucket_id = 'app-icons' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "auth users delete own app icons" on storage.objects for delete to authenticated
  using (bucket_id = 'app-icons' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners read own app icons" on storage.objects for select to authenticated
  using (bucket_id = 'app-icons' and (storage.foldername(name))[1] = auth.uid()::text);