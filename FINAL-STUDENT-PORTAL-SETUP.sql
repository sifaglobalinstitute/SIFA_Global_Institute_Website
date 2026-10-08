-- SIFA Global Institute — Final Student Portal security setup (V2)
-- Run once AFTER student-portal-schema.sql and ADMISSIONS-SETUP.sql.
-- This closes admissions, adds student self-service RPCs, and reloads PostgREST schema cache.

begin;

-- 1. Close admissions. Existing applications are preserved.
update public.admission_settings
set applications_open = false,
    open_programs = '{}',
    updated_at = now()
where id = true;

-- 2. Student can withdraw only their own active application.
drop function if exists public.withdraw_my_application(uuid);
create or replace function public.withdraw_my_application(application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.applications
  set status = 'Withdrawn', updated_at = now()
  where id = application_id
    and user_id = auth.uid()
    and status in ('Submitted','Under Review','Needs Information','Accepted');

  if not found then
    raise exception 'This application cannot be withdrawn or does not belong to your account.';
  end if;
end;
$$;

revoke all on function public.withdraw_my_application(uuid) from public;
grant execute on function public.withdraw_my_application(uuid) to authenticated;

-- 3. Student can permanently delete their own account.
-- The function is SECURITY DEFINER so the browser never needs a service-role key.
drop function if exists public.delete_my_account();
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  -- Remove private uploaded documents owned by this student first.
  delete from storage.objects
  where bucket_id = 'student-documents'
    and (storage.foldername(name))[1] = uid::text;

  -- profiles and applications are linked with ON DELETE CASCADE.
  delete from auth.users
  where id = uid;

  if not found then
    raise exception 'Account could not be found.';
  end if;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- 4. Authenticated users can read admission status; they cannot modify it from the browser.
grant select on public.admission_settings to authenticated;

commit;

-- 5. Refresh PostgREST so the new RPC functions are immediately discoverable.
notify pgrst, 'reload schema';
