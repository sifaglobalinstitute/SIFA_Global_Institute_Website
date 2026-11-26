BEGIN;
GRANT SELECT ON public.admission_settings, public.applications TO service_role;
GRANT SELECT, UPDATE ON public.sifa_public_applications TO service_role;
CREATE TABLE IF NOT EXISTS public.sifa_classroom_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 program text NOT NULL REFERENCES public.sifa_programs(program_name),
 resource_type text NOT NULL CHECK(resource_type IN ('live','link','admission_notice')),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 resource_url text,
 published boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((resource_type='admission_notice' AND resource_url IS NULL) OR (resource_type IN ('live','link') AND resource_url IS NOT NULL AND resource_url LIKE 'https://%'))
);
ALTER TABLE public.sifa_classroom_resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sifa_classroom_resources FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sifa_classroom_resources TO service_role;
CREATE INDEX IF NOT EXISTS sifa_resources_program_pub_idx ON public.sifa_classroom_resources(program,published,resource_type,created_at DESC);
CREATE INDEX IF NOT EXISTS sifa_public_apps_owner_status_idx ON public.sifa_public_applications(linked_user_id,status,program);
CREATE INDEX IF NOT EXISTS sifa_legacy_apps_owner_status_idx ON public.applications(user_id,status);
CREATE INDEX IF NOT EXISTS sifa_scholarship_public_idx ON public.sifa_scholarship_decisions(public_application_id);
CREATE INDEX IF NOT EXISTS sifa_scholarship_legacy_idx ON public.sifa_scholarship_decisions(application_id);
CREATE OR REPLACE FUNCTION public.sifa_student_support_v3(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH own_apps AS (
 SELECT a.id,'public'::text AS source,a.application_ref,a.program,a.status FROM public.sifa_public_applications a WHERE a.linked_user_id=p_user_id
 UNION ALL SELECT a.id,'legacy',a.application_ref,a.payload->>'course',a.status FROM public.applications a WHERE a.user_id=p_user_id
 ), awards AS (
 SELECT a.id AS application_id,a.source,a.application_ref,a.program,a.status AS admission_status,s.decision,s.monthly_discount_percent,s.starts_on,s.ends_on,s.decided_at
 FROM own_apps a JOIN public.sifa_scholarship_decisions s ON (a.source='public' AND s.public_application_id=a.id) OR (a.source='legacy' AND s.application_id=a.id)
 ORDER BY s.created_at DESC LIMIT 200
 ), notices AS (
 SELECT r.id,r.program,r.title,r.description,r.created_at FROM public.sifa_classroom_resources r WHERE r.published AND r.resource_type='admission_notice' AND EXISTS(SELECT 1 FROM own_apps a WHERE a.status='Accepted' AND a.program=r.program) ORDER BY r.created_at DESC LIMIT 100
 ) SELECT jsonb_build_object('awards',COALESCE((SELECT jsonb_agg(to_jsonb(awards)) FROM awards),'[]'::jsonb),'announcements',COALESCE((SELECT jsonb_agg(to_jsonb(notices)) FROM notices),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.sifa_student_support_v3(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sifa_student_support_v3(uuid) TO service_role;
COMMIT;
