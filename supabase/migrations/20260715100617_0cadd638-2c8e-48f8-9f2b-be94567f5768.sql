
create table if not exists public.user_notepad (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_notepad to authenticated;
grant all on public.user_notepad to service_role;
alter table public.user_notepad enable row level security;
create policy "own notepad all" on public.user_notepad for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.user_online_service (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_online_service to authenticated;
grant all on public.user_online_service to service_role;
alter table public.user_online_service enable row level security;
create policy "own online all" on public.user_online_service for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
