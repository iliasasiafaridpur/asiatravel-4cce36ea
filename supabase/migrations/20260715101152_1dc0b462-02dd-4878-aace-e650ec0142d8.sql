
-- Drop per-user policies
drop policy if exists "own notepad all" on public.user_notepad;
drop policy if exists "own online all" on public.user_online_service;

-- Allow all authenticated users to read/write shared data
create policy "shared notepad all" on public.user_notepad
  for all to authenticated using (true) with check (true);

create policy "shared online all" on public.user_online_service
  for all to authenticated using (true) with check (true);
