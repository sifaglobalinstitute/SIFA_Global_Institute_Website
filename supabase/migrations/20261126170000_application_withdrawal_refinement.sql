BEGIN;
CREATE OR REPLACE FUNCTION public.sifa_withdraw_my_application(p_application_id uuid, p_source text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user uuid := auth.uid();
    v_status text;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_source = 'public' THEN

        SELECT status INTO v_status
        FROM public.sifa_public_applications
        WHERE id = p_application_id
        AND linked_user_id = v_user
        FOR UPDATE;

    ELSIF p_source = 'legacy' THEN

        SELECT status INTO v_status
        FROM public.applications
        WHERE id = p_application_id
        AND user_id = v_user
        FOR UPDATE;

    ELSE
        RAISE EXCEPTION 'Invalid application source.';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    IF v_status NOT IN (
        'Submitted',
        'Under Review',
        'Needs Information'
    ) THEN
        RAISE EXCEPTION
        'This application cannot be withdrawn online.';
    END IF;

    PERFORM 1 FROM public.sifa_scholarship_decisions s
    WHERE (p_source = 'public' AND s.public_application_id = p_application_id)
       OR (p_source = 'legacy' AND s.application_id = p_application_id)
    FOR UPDATE;

    IF EXISTS (
        SELECT 1
        FROM public.sifa_enrollments e
        WHERE
            (p_source = 'public'
             AND e.public_application_id = p_application_id)
            OR
            (p_source = 'legacy'
             AND e.application_id = p_application_id)
    ) OR EXISTS (
        SELECT 1
        FROM public.sifa_scholarship_decisions s
        WHERE s.decision = 'approved' AND (
            (p_source = 'public' AND s.public_application_id = p_application_id)
            OR (p_source = 'legacy' AND s.application_id = p_application_id)
        )
    ) THEN
        RAISE EXCEPTION
        'Please contact SIFA to withdraw this application.';
    END IF;

    IF p_source = 'public' THEN

        UPDATE public.sifa_public_applications
        SET status = 'Withdrawn',
            updated_at = now()
        WHERE id = p_application_id
        AND linked_user_id = v_user;

    ELSE

        UPDATE public.applications
        SET status = 'Withdrawn',
            updated_at = now()
        WHERE id = p_application_id
        AND user_id = v_user;

    END IF;

    UPDATE public.sifa_scholarship_decisions s
    SET decision = 'withdrawn', monthly_discount_percent = 0,
        decided_at = now(), decided_by = NULL,
        reason = 'Applicant withdrew the linked application.'
    WHERE s.decision = 'pending' AND (
        (p_source = 'public' AND s.public_application_id = p_application_id)
        OR (p_source = 'legacy' AND s.application_id = p_application_id)
    );
    RETURN true;
END;
$function$;

-- Prevent stale staff requests from reopening a withdrawn record.
CREATE OR REPLACE FUNCTION public.sifa_guard_withdrawn_application()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.status = 'Withdrawn' AND NEW.status IS DISTINCT FROM OLD.status THEN
   RAISE EXCEPTION 'Withdrawn applications cannot be reopened; submit a new application.';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.sifa_guard_withdrawn_application() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sifa_withdrawn_terminal ON public.applications;
CREATE TRIGGER sifa_withdrawn_terminal BEFORE UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION public.sifa_guard_withdrawn_application();
DROP TRIGGER IF EXISTS sifa_withdrawn_terminal ON public.sifa_public_applications;
CREATE TRIGGER sifa_withdrawn_terminal BEFORE UPDATE OF status ON public.sifa_public_applications FOR EACH ROW EXECUTE FUNCTION public.sifa_guard_withdrawn_application();

-- Serialize linked scholarship/enrollment changes against withdrawal.
CREATE OR REPLACE FUNCTION public.sifa_guard_withdrawn_application_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
 IF NEW.public_application_id IS NOT NULL THEN
   SELECT status INTO v_status FROM public.sifa_public_applications WHERE id=NEW.public_application_id FOR UPDATE;
 ELSIF NEW.application_id IS NOT NULL THEN
   SELECT status INTO v_status FROM public.applications WHERE id=NEW.application_id FOR UPDATE;
 ELSE RETURN NEW;
 END IF;
 IF v_status = 'Withdrawn' THEN
   IF TG_TABLE_NAME = 'sifa_scholarship_decisions' THEN
     IF NEW.decision = 'withdrawn' THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'Cannot create or change this linked record for a withdrawn application.';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.sifa_guard_withdrawn_application_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sifa_guard_withdrawn_link ON public.sifa_scholarship_decisions;
CREATE TRIGGER sifa_guard_withdrawn_link BEFORE INSERT OR UPDATE OF decision, public_application_id, application_id ON public.sifa_scholarship_decisions FOR EACH ROW EXECUTE FUNCTION public.sifa_guard_withdrawn_application_link();
DROP TRIGGER IF EXISTS sifa_guard_withdrawn_link ON public.sifa_enrollments;
CREATE TRIGGER sifa_guard_withdrawn_link BEFORE INSERT OR UPDATE OF public_application_id, application_id ON public.sifa_enrollments FOR EACH ROW EXECUTE FUNCTION public.sifa_guard_withdrawn_application_link();
REVOKE ALL ON FUNCTION public.sifa_withdraw_my_application(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sifa_withdraw_my_application(uuid,text) TO authenticated;

COMMIT;
