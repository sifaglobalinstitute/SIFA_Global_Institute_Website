-- Restore original review logic only; does not undo financial transactions.
BEGIN;
CREATE OR REPLACE FUNCTION public.sifa_review_payment_receipt(p_receipt_id uuid, p_status text, p_reviewer uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_receipt public.sifa_payment_receipts%ROWTYPE;
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_now timestamptz := now();
    v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    -- Only the trusted service-role backend may call this RPC.
    IF current_user <> 'service_role'
       AND session_user <> 'service_role' THEN
        -- This is a supplemental guard.
        -- PostgreSQL EXECUTE grants remain the primary boundary.
        NULL;
    END IF;

    IF p_status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid receipt decision';
    END IF;

    SELECT *
    INTO v_receipt
    FROM public.sifa_payment_receipts
    WHERE id = p_receipt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Receipt not found';
    END IF;

    IF v_receipt.status <> 'pending_review' THEN
        RAISE EXCEPTION 'Receipt has already been reviewed';
    END IF;

    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = v_receipt.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.status <> 'receipt_submitted' THEN
        RAISE EXCEPTION
            'Invoice is not awaiting receipt review';
    END IF;

    IF p_status = 'approved' THEN

        IF v_receipt.claimed_currency <> v_invoice.currency
           OR v_receipt.claimed_amount < v_invoice.amount_due THEN
            RAISE EXCEPTION
                'Receipt amount or currency does not match invoice';
        END IF;

        UPDATE public.sifa_fee_invoices
        SET status = 'paid'
        WHERE id = v_invoice.id;

        -- Activate only a current monthly-course enrollment.
        -- Never activate certificate-fee invoices.
        -- Never automatically reactivate suspended enrollments.
        IF v_invoice.invoice_type = 'monthly_course'
           AND v_invoice.period_start <= v_today
           AND v_invoice.period_end >= v_today THEN

            UPDATE public.sifa_enrollments
            SET status = 'active',
                updated_at = v_now
            WHERE id = v_invoice.enrollment_id
              AND student_user_id = v_receipt.student_user_id
              AND status = 'pending_payment'
              AND (start_date IS NULL OR start_date <= v_today)
              AND (end_date IS NULL OR end_date >= v_today);

        END IF;

    ELSE
        UPDATE public.sifa_fee_invoices
        SET status = 'unpaid'
        WHERE id = v_invoice.id;
    END IF;

    UPDATE public.sifa_payment_receipts
    SET status = p_status,
        reviewer_user_id = p_reviewer,
        reviewed_at = v_now,
        reviewer_note = NULLIF(TRIM(COALESCE(p_note, '')), '')
    WHERE id = v_receipt.id;

    INSERT INTO public.sifa_audit_log(
        actor_user_id,
        action,
        entity_type,
        entity_id,
        before_data,
        after_data,
        reason
    )
    VALUES (
        p_reviewer,
        'payment_receipt_review',
        'payment_receipt',
        v_receipt.id,
        jsonb_build_object(
            'receipt_status', v_receipt.status,
            'invoice_status', v_invoice.status
        ),
        jsonb_build_object(
            'receipt_status', p_status,
            'invoice_id', v_invoice.id,
            'invoice_status',
            CASE WHEN p_status = 'approved'
                 THEN 'paid' ELSE 'unpaid' END
        ),
        p_note
    );

    RETURN jsonb_build_object(
        'id', v_receipt.id,
        'invoice_id', v_receipt.invoice_id,
        'status', p_status,
        'reviewed_at', v_now
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.sifa_review_payment_receipt(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sifa_review_payment_receipt(uuid, text, uuid, text) TO service_role;
COMMIT;
