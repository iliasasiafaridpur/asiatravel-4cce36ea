
-- Replace user-scoped rows with a single shared row per table
alter table public.user_notepad drop constraint if exists user_notepad_pkey;
alter table public.user_notepad drop constraint if exists user_notepad_user_id_fkey;
alter table public.user_notepad alter column user_id drop not null;
alter table public.user_notepad add column if not exists scope text not null default 'shared';
delete from public.user_notepad where scope = 'shared' and ctid not in (
  select ctid from public.user_notepad where scope = 'shared' order by updated_at desc nulls last limit 1
);
alter table public.user_notepad add constraint user_notepad_scope_key unique (scope);

alter table public.user_online_service drop constraint if exists user_online_service_pkey;
alter table public.user_online_service drop constraint if exists user_online_service_user_id_fkey;
alter table public.user_online_service alter column user_id drop not null;
alter table public.user_online_service add column if not exists scope text not null default 'shared';
delete from public.user_online_service where scope = 'shared' and ctid not in (
  select ctid from public.user_online_service where scope = 'shared' order by updated_at desc nulls last limit 1
);
alter table public.user_online_service add constraint user_online_service_scope_key unique (scope);
