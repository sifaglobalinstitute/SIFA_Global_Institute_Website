BEGIN;
CREATE OR REPLACE FUNCTION public.sifa_set_classroom_authorization(
 p_enrollment_id uuid, p_actor uuid, p_mode text, p_reason text,
 p_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
 e public.sifa_enrollments%ROWTYPE;
 v_after jsonb;
 v_now timestamptz;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('grant','revoke','grace') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 8 AND 1000 THEN
  RAISE EXCEPTION 'A valid action and reason are required.';
 END IF;
 PERFORM 1 FROM public.sifa_staff_roles WHERE user_id=p_actor AND role='administrator' AND active=true FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active administrator required.'; END IF;
 SELECT * INTO e FROM public.sifa_enrollments WHERE id=p_enrollment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found.'; END IF;
 v_now := clock_timestamp();
 IF p_mode <> 'revoke' THEN
  IF e.status NOT IN ('active','pending_payment') THEN RAISE EXCEPTION 'Enrollment is not eligible for authorization.'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.sifa_public_applications a WHERE a.id=e.public_application_id AND a.linked_user_id=e.student_user_id AND a.program=e.program AND a.status='Accepted') OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id=e.application_id AND a.user_id=e.student_user_id AND a.payload->>'course'=e.program AND a.status='Accepted')) THEN
   RAISE EXCEPTION 'A matching accepted application is required.';
  END IF;
 END IF;
 IF p_mode='grace' AND (p_expires_at IS NULL OR p_expires_at<=v_now OR p_expires_at>v_now+interval '31 days') THEN RAISE EXCEPTION 'Grace period must expire within 31 days.'; END IF;
 IF p_mode='grace' AND (e.start_date IS NULL OR e.end_date IS NULL OR e.end_date<(v_now AT TIME ZONE 'UTC')::date OR p_expires_at <= (e.start_date::timestamp AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'Grace period must overlap the enrollment dates.'; END IF;
 UPDATE public.sifa_enrollments SET
  classroom_access_authorized=(p_mode<>'revoke'),
  classroom_access_authorized_by=CASE WHEN p_mode='revoke' THEN NULL ELSE p_actor END,
  classroom_access_authorized_at=CASE WHEN p_mode='revoke' THEN NULL ELSE v_now END,
  classroom_access_authorization_reason=CASE WHEN p_mode='revoke' THEN NULL ELSE trim(p_reason) END,
  status=CASE WHEN p_mode='grace' THEN 'active' ELSE status END,
  access_exception_reason=CASE WHEN p_mode='grace' THEN trim(p_reason) ELSE NULL END,
  access_exception_approved_by=CASE WHEN p_mode='grace' THEN p_actor ELSE NULL END,
  access_exception_expires_at=CASE WHEN p_mode='grace' THEN p_expires_at ELSE NULL END,
  updated_at=v_now
 WHERE id=e.id
 RETURNING jsonb_build_object('id',id,'status',status,'program',program,'classroom_access_authorized',classroom_access_authorized,'access_exception_expires_at',access_exception_expires_at) INTO v_after;
 INSERT INTO public.sifa_audit_log(actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
 VALUES(p_actor,'classroom_authorization_'||p_mode,'enrollment',e.id,jsonb_build_object('status',e.status,'classroom_access_authorized',e.classroom_access_authorized,'access_exception_expires_at',e.access_exception_expires_at),v_after,trim(p_reason));
 RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.sifa_set_classroom_authorization(uuid,uuid,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sifa_set_classroom_authorization(uuid,uuid,text,text,timestamptz) TO service_role;
COMMIT;
