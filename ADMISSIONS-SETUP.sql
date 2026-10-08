-- SIFA Global Institute — Admissions control hardening
-- Run this AFTER student-portal-schema.sql in Supabase SQL Editor.
-- This adds a server-side admissions switch so browser code alone cannot bypass it.

create table if not exists public.admission_settings (
  id boolean primary key default true check (id = true),
  applications_open boolean not null default false,
  open_programs text[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into public.admission_settings (id, applications_open, open_programs)
values (true, true, array['QuickBooks Practical Training'])
on conflict (id) do update set
  applications_open = excluded.applications_open,
  open_programs = excluded.open_programs,
  updated_at = now();

alter table public.admission_settings enable row level security;

drop policy if exists "Authenticated users can view admissions settings" on public.admission_settings;
create policy "Authenticated users can view admissions settings"
on public.admission_settings for select to authenticated
using (true);

grant select on public.admission_settings to authenticated;

create or replace function public.check_application_admission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.admission_settings%rowtype;
  requested_program text;
begin
  select * into settings from public.admission_settings where id = true;
  requested_program := coalesce(new.payload->>'course', '');

  if coalesce(settings.applications_open, false) is not true then
    raise exception 'Applications are currently closed.';
  end if;

  if not (requested_program = any(settings.open_programs)) then
    raise exception 'This program is not currently open for application.';
  end if;

  if requested_program <> 'QuickBooks Practical Training' then
    raise exception 'Only QuickBooks Practical Training is currently open for application.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_application_admission on public.applications;
create trigger enforce_application_admission
before insert on public.applications
for each row execute function public.check_application_admission();

-- To close all applications later:
-- update public.admission_settings set applications_open = false, updated_at = now() where id = true;
-- To reopen QuickBooks later:
-- update public.admission_settings set applications_open = true, open_programs = array['QuickBooks Practical Training'], updated_at = now() where id = true;
