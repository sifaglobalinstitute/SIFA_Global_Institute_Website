-- SIFA Global Institute — Student Portal / Applications schema
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  application_ref text unique not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'Submitted' check (status in ('Draft','Submitted','Under Review','Needs Information','Accepted','Rejected','Withdrawn')),
  full_name text not null,
  email text not null,
  submitted_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  document_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_user_id_idx on public.applications(user_id);
create index if not exists applications_status_idx on public.applications(status);

alter table public.profiles enable row level security;
alter table public.applications enable row level security;

drop policy if exists "Students can view own profile" on public.profiles;
create policy "Students can view own profile"
on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists "Students can update own profile" on public.profiles;
create policy "Students can update own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Students can view own applications" on public.applications;
create policy "Students can view own applications"
on public.applications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Students can submit own applications" on public.applications;
create policy "Students can submit own applications"
on public.applications for insert to authenticated
with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

-- Students can upload only inside their own UUID folder.
drop policy if exists "Students upload own documents" on storage.objects;
create policy "Students upload own documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Students can view only their own uploaded documents.
drop policy if exists "Students view own documents" on storage.objects;
create policy "Students view own documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Students can delete only their own documents.
drop policy if exists "Students delete own documents" on storage.objects;
create policy "Students delete own documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- Data API permissions for the authenticated browser client. RLS remains the authorization layer.
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.applications to authenticated;
