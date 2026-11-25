-- SIFA: reconstructed from the verified SIFA-Testing database definitions.
-- Review and test on a clean staging baseline before production deployment.
-- Requires existing financial integrity migration and baseline SIFA tables.
BEGIN;

CREATE TABLE public.sifa_programs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_name text NOT NULL UNIQUE,
    category text NOT NULL,
    duration_months integer NOT NULL CHECK (duration_months >= 1 AND duration_months <= 36),
    admissions_open boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sifa_programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sifa_programs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sifa_programs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sifa_programs TO service_role;
CREATE POLICY "Read active SIFA programs" ON public.sifa_programs
    FOR SELECT TO anon, authenticated USING (is_active = true);

INSERT INTO public.sifa_programs (program_name, category, duration_months, display_order) VALUES
('QuickBooks Practical Training', 'International Accounting Software', 4, 1),
('Sage Accounting Training', 'International Accounting Software', 2, 2),
('Tally Practical Accounting', 'International Accounting Software', 2, 3),
('Xero Accounting', 'International Accounting Software', 2, 4),
('Zoho Books', 'International Accounting Software', 2, 5),
('Odoo Accounting & Business Systems', 'ERP Systems', 2, 6),
('SAP Financial & Business Systems', 'ERP Systems', 2, 7),
('Oracle NetSuite', 'ERP Systems', 2, 8),
('Microsoft Dynamics 365', 'ERP Systems', 2, 9),
('ETA Accounting', 'Turkish Accounting Software', 2, 10),
('Logo Accounting & ERP', 'Turkish Accounting Software', 2, 11),
('Mikro Accounting & ERP', 'Turkish Accounting Software', 2, 12),
('LUCA Accounting', 'Turkish Accounting Software', 2, 13),
('Zirve Accounting', 'Turkish Accounting Software', 2, 14),
('DİA Business Software', 'Turkish Accounting Software', 2, 15),
('Paraşüt Accounting', 'Turkish Accounting Software', 2, 16),
('AKINSOFT Wolvox', 'Turkish Accounting Software', 2, 17),
('Nebim', 'Turkish Accounting Software', 2, 18),
('Accounting Fundamentals', 'Accounting & Financial Education', 1, 19),
('Financial Reporting & Analysis', 'Accounting & Financial Education', 1, 20),
('Digital Finance & Professional Tools', 'Accounting & Financial Education', 2, 21),
('Microsoft Excel for Accounting & Finance', 'Microsoft Office & Business Intelligence', 1, 22),
('Power BI for Financial Analysis', 'Microsoft Office & Business Intelligence', 1, 23),
('Advanced Excel & Financial Modeling', 'Microsoft Office & Business Intelligence', 1, 24),
('Advanced Microsoft Word', 'Microsoft Office & Business Intelligence', 1, 25),
('Advanced Microsoft PowerPoint', 'Microsoft Office & Business Intelligence', 1, 26);
-- Preserve the historical internal test program.
INSERT INTO public.sifa_programs (
    program_name,
    category,
    duration_months,
    admissions_open,
    is_active,
    display_order
)
VALUES (
    'SIFA TEST - Payment and Classroom Workflow',
    'Internal Testing',
    1,
    false,
    false,
    999
)
ON CONFLICT (program_name) DO NOTHING;
-- Refuse inconsistent historical records rather than rewriting them.
DO $check$
BEGIN
    IF EXISTS (
        SELECT 1 FROM (
            SELECT program FROM public.sifa_certificate_registry
            UNION ALL SELECT program FROM public.sifa_enrollments
            UNION ALL SELECT program FROM public.sifa_learning_materials
            UNION ALL SELECT program FROM public.sifa_public_applications
        ) AS existing
        WHERE NOT EXISTS (
            SELECT 1 FROM public.sifa_programs p WHERE p.program_name = existing.program
        )
    ) THEN
        RAISE EXCEPTION 'Unmatched historical program names: review before migration';
    END IF;
    IF EXISTS (SELECT 1 FROM public.admission_settings WHERE applications_open OR cardinality(open_programs) > 0) THEN
        RAISE EXCEPTION 'Existing admissions are not closed: review configuration before migration';
    END IF;
END;
$check$;

ALTER TABLE public.sifa_certificate_registry ADD CONSTRAINT sifa_certificate_registry_program_fk FOREIGN KEY (program) REFERENCES public.sifa_programs(program_name) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.sifa_enrollments ADD CONSTRAINT sifa_enrollments_program_fk FOREIGN KEY (program) REFERENCES public.sifa_programs(program_name) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.sifa_learning_materials ADD CONSTRAINT sifa_learning_materials_program_fk FOREIGN KEY (program) REFERENCES public.sifa_programs(program_name) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.sifa_public_applications ADD CONSTRAINT sifa_public_applications_program_fk FOREIGN KEY (program) REFERENCES public.sifa_programs(program_name) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE FUNCTION public.sifa_apply_program_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
    v_duration integer;
BEGIN
    SELECT duration_months INTO v_duration
    FROM public.sifa_programs
    WHERE program_name = NEW.program AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected program is not available';
    END IF;
    IF NEW.start_date IS NULL THEN
        RAISE EXCEPTION 'Enrollment start date is required';
    END IF;
    NEW.end_date := (NEW.start_date + make_interval(months => v_duration))::date - 1;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER sifa_enrollment_program_duration
BEFORE INSERT ON public.sifa_enrollments
FOR EACH ROW EXECUTE FUNCTION public.sifa_apply_program_duration();

CREATE FUNCTION public.sifa_get_learning_eligibility(p_student_user_id uuid)
RETURNS TABLE(enrollment_id uuid, program text, access_basis text)
LANGUAGE sql STABLE SET search_path TO '' AS $function$
WITH eligible AS (
    SELECT e.id, e.program, e.status,
        EXISTS (
            SELECT 1 FROM public.sifa_fee_invoices i
            WHERE i.enrollment_id = e.id
              AND i.invoice_type = 'monthly_course'
              AND i.period_start <= (now() AT TIME ZONE 'UTC')::date
              AND i.period_end >= (now() AT TIME ZONE 'UTC')::date
              AND ((i.status = 'paid' AND i.amount_due > 0)
                OR (i.status = 'waived' AND i.amount_due = 0))
        ) AS verified_payment,
        (e.status = 'active'
         AND e.access_exception_approved_by IS NOT NULL
         AND NULLIF(trim(e.access_exception_reason), '') IS NOT NULL
         AND e.access_exception_expires_at > now()) AS valid_exception
    FROM public.sifa_enrollments e
    WHERE e.student_user_id = p_student_user_id
      AND e.status IN ('active', 'pending_payment')
      AND e.start_date <= (now() AT TIME ZONE 'UTC')::date
      AND e.end_date >= (now() AT TIME ZONE 'UTC')::date
)
SELECT id, eligible.program,
    CASE WHEN verified_payment THEN 'verified_payment' ELSE 'authorized_exception' END
FROM eligible
WHERE verified_payment OR valid_exception;
$function$;

REVOKE ALL ON FUNCTION public.sifa_get_learning_eligibility(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sifa_get_learning_eligibility(uuid) TO service_role;

-- Existing admission trigger and updated_at functions are intentionally untouched.
-- No existing enrollments, payment records, or admission settings are rewritten.
COMMIT;
