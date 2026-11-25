-- DRAFT: test in isolated database before production.
-- Phase 1: payment review only. Requires existing SIFA financial schema.
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
    v_quote public.sifa_payment_quotes%ROWTYPE;
    v_invoice_id uuid;
    v_owner uuid;
    v_now timestamptz := now();
    v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    -- Execution is restricted to the trusted backend by grants below.
    IF p_receipt_id IS NULL OR p_status IS NULL
       OR p_status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid receipt decision';
    END IF;
    PERFORM 1 FROM public.sifa_staff_roles
    WHERE user_id = p_reviewer AND active = true
      AND role IN ('administrator', 'finance_reviewer')
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active finance reviewer or administrator required';
    END IF;

    -- Acquire invoice lock before receipt/quote locks.
    SELECT invoice_id INTO v_invoice_id
    FROM public.sifa_payment_receipts WHERE id = p_receipt_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    SELECT * INTO v_invoice FROM public.sifa_fee_invoices
    WHERE id = v_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    SELECT * INTO v_receipt FROM public.sifa_payment_receipts
    WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    IF v_receipt.invoice_id IS DISTINCT FROM v_invoice.id
       OR v_receipt.status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'Receipt no longer eligible for review';
    END IF;
    SELECT student_user_id INTO v_owner FROM public.sifa_enrollments
    WHERE id = v_invoice.enrollment_id FOR UPDATE;
    IF NOT FOUND OR v_owner IS NULL
       OR v_owner IS DISTINCT FROM v_receipt.student_user_id THEN
        RAISE EXCEPTION 'Receipt does not belong to invoice owner';
    END IF;

    IF v_invoice.status IS DISTINCT FROM 'receipt_submitted' THEN
        RAISE EXCEPTION
            'Invoice is not awaiting receipt review';
    END IF;

    IF p_status = 'approved' THEN

        IF v_receipt.claimed_amount IS NULL
           OR v_receipt.claimed_amount::text IN ('NaN','Infinity','-Infinity')
           OR v_receipt.claimed_amount <= 0
           OR v_invoice.amount_due IS NULL
           OR v_invoice.amount_due::text IN ('NaN','Infinity','-Infinity')
           OR v_invoice.amount_due <= 0 THEN
            RAISE EXCEPTION 'Invalid financial amount';
        END IF;
        IF NOT COALESCE(
            (v_receipt.claimed_currency = 'RWF' AND v_receipt.payment_method = 'Rwanda Mobile Money') OR
            (v_receipt.claimed_currency = 'TRY' AND v_receipt.payment_method = 'Ziraat Bank Transfer') OR
            (v_receipt.claimed_currency = 'USD' AND v_receipt.payment_method = 'Ziraat USD Bank Transfer'), false
        ) THEN RAISE EXCEPTION 'Invalid payment method or currency'; END IF;

        IF v_receipt.payment_quote_id IS NULL THEN
            -- Preserve submission behavior; hold overpayments for reconciliation.
            IF v_receipt.claimed_currency IS DISTINCT FROM v_invoice.currency
               OR v_receipt.claimed_amount IS DISTINCT FROM v_invoice.amount_due THEN
                RAISE EXCEPTION 'Direct payment requires exact invoice amount and currency';
            END IF;
        ELSE
            SELECT * INTO v_quote FROM public.sifa_payment_quotes
            WHERE id = v_receipt.payment_quote_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Payment quote not found'; END IF;
            -- Timely submissions may be reviewed after the quote's validity ends.
            IF v_quote.invoice_id IS DISTINCT FROM v_invoice.id
               OR v_quote.status IS DISTINCT FROM 'approved'
               OR v_quote.approved_by IS NULL
               OR v_quote.approved_at IS NULL OR v_quote.valid_until IS NULL
               OR v_receipt.submitted_at IS NULL
               OR v_receipt.submitted_at < v_quote.approved_at
               OR v_receipt.submitted_at >= v_quote.valid_until
               OR v_quote.payment_currency IS DISTINCT FROM v_receipt.claimed_currency
               OR v_quote.payment_method IS DISTINCT FROM v_receipt.payment_method
               OR v_quote.payable_amount IS DISTINCT FROM v_receipt.claimed_amount
               OR v_quote.exchange_rate IS NULL
               OR v_quote.exchange_rate::text IN ('NaN','Infinity','-Infinity')
               OR v_quote.exchange_rate <= 0 THEN
                RAISE EXCEPTION 'Receipt does not match a valid approved quote';
            END IF;
            IF v_quote.payable_amount IS DISTINCT FROM
   round(v_invoice.amount_due * v_quote.exchange_rate, 2)
               OR (v_quote.payment_currency = v_invoice.currency AND
                   (v_quote.exchange_rate <> 1 OR v_quote.payable_amount <> v_invoice.amount_due)) THEN
                RAISE EXCEPTION 'Approved quote no longer matches invoice';
            END IF;
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

-- Phase 2: Secure expired payment quote replacement.

CREATE OR REPLACE FUNCTION public.sifa_approve_payment_quote(
    p_invoice_id uuid,
    p_payment_method text,
    p_payment_currency text,
    p_payable_amount numeric,
    p_exchange_rate numeric,
    p_valid_until timestamp with time zone,
    p_approval_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_quote_id uuid;
    v_admin_id uuid;
    v_now timestamptz;
BEGIN
    v_admin_id := auth.uid();

    -- Verify active administrator authorization.
    PERFORM 1
    FROM public.sifa_staff_roles
    WHERE user_id = v_admin_id
      AND role = 'administrator'
      AND active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator permission required';
    END IF;

    -- Validate payment method and currency.
    IF NOT COALESCE(
        (p_payment_currency = 'RWF'
         AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_payment_currency = 'TRY'
         AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_payment_currency = 'USD'
         AND p_payment_method = 'Ziraat USD Bank Transfer'),
        false
    ) THEN
        RAISE EXCEPTION 'Invalid payment method or currency';
    END IF;

    -- Reject invalid financial values.
    IF p_payable_amount IS NULL
       OR p_payable_amount::text IN
          ('NaN', 'Infinity', '-Infinity')
       OR p_payable_amount <= 0
      OR p_payable_amount > 9999999999.99
OR p_payable_amount <> round(p_payable_amount, 2) THEN
        RAISE EXCEPTION 'Invalid payable amount';
    END IF;

    IF p_exchange_rate IS NULL
       OR p_exchange_rate::text IN
          ('NaN', 'Infinity', '-Infinity')
       OR p_exchange_rate <= 0
OR p_exchange_rate > 999999999999.99999999
OR p_exchange_rate <> round(p_exchange_rate, 8) THEN
        RAISE EXCEPTION 'Invalid exchange rate';
    END IF;

    IF p_approval_note IS NULL
       OR length(trim(p_approval_note)) < 10
       OR length(p_approval_note) > 1000 THEN
        RAISE EXCEPTION 'A detailed approval note is required';
    END IF;

    -- Lock invoice to serialize payment operations.
    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    v_now := clock_timestamp();

    IF p_valid_until IS NULL
       OR p_valid_until <= v_now
       OR p_valid_until > v_now + interval '7 days' THEN
        RAISE EXCEPTION 'Quote validity must be within 7 days';
    END IF;

    IF v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'Invoice is not eligible for payment';
    END IF;

    IF v_invoice.amount_due IS NULL
       OR v_invoice.amount_due::text IN
          ('NaN', 'Infinity', '-Infinity')
       OR v_invoice.amount_due <= 0 THEN
        RAISE EXCEPTION 'Invalid invoice amount';
    END IF;

    -- Protect receipts awaiting verification.
    IF EXISTS (
        SELECT 1
        FROM public.sifa_payment_receipts
        WHERE invoice_id = p_invoice_id
          AND status = 'pending_review'
    ) THEN
        RAISE EXCEPTION
            'Cannot replace a quote while a receipt is under review';
    END IF;

    -- Verify conversion amount.
    IF p_payable_amount IS DISTINCT FROM
    round(v_invoice.amount_due * p_exchange_rate, 2)
THEN
        RAISE EXCEPTION 'Amount does not match the exchange rate';
    END IF;

    -- Same-currency quotes must match the invoice.
    IF v_invoice.currency = p_payment_currency
       AND (
           p_exchange_rate <> 1
           OR p_payable_amount <> v_invoice.amount_due
       ) THEN
        RAISE EXCEPTION 'Same-currency quote must match invoice';
    END IF;

    -- Expire old quotes without deleting financial history.
    UPDATE public.sifa_payment_quotes
    SET status = 'expired',
        updated_at = v_now
    WHERE invoice_id = p_invoice_id
      AND status = 'approved'
      AND valid_until <= v_now;

    -- An unexpired approved quote must not be replaced.
    IF EXISTS (
        SELECT 1
        FROM public.sifa_payment_quotes
        WHERE invoice_id = p_invoice_id
          AND status = 'approved'
    ) THEN
        RAISE EXCEPTION
            'An active approved quote already exists for this invoice';
    END IF;

    -- Create the replacement quote.
    INSERT INTO public.sifa_payment_quotes (
        invoice_id,
        payment_method,
        payment_currency,
        payable_amount,
        exchange_rate,
        status,
        approved_by,
        approved_at,
        valid_until,
        approval_note
    )
    VALUES (
        p_invoice_id,
        p_payment_method,
        p_payment_currency,
        p_payable_amount,
        p_exchange_rate,
        'approved',
        v_admin_id,
        v_now,
        p_valid_until,
        trim(p_approval_note)
    )
    RETURNING id INTO v_quote_id;

    INSERT INTO public.sifa_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data,
    reason
)
VALUES (
    v_admin_id,
    'payment_quote_approved',
    'payment_quote',
    v_quote_id,
    jsonb_build_object(
        'invoice_id', p_invoice_id,
        'payment_currency', p_payment_currency,
        'payment_method', p_payment_method,
        'payable_amount', p_payable_amount,
        'exchange_rate', p_exchange_rate,
        'valid_until', p_valid_until
    ),
    trim(p_approval_note)
);

RETURN v_quote_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sifa_approve_payment_quote(
    uuid, text, text, numeric, numeric,
    timestamp with time zone, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sifa_approve_payment_quote(
    uuid, text, text, numeric, numeric,
    timestamp with time zone, text
) TO authenticated, service_role;

-- ============================================================
-- PHASE 3: Secure direct payment receipt submission
-- ============================================================

CREATE OR REPLACE FUNCTION public.sifa_submit_payment_receipt_v2(
    p_invoice_id uuid,
    p_student_user_id uuid,
    p_storage_path text,
    p_payment_method text,
    p_claimed_amount numeric,
    p_claimed_currency text,
    p_transaction_reference text,
    p_sender_full_name text,
    p_sender_contact text,
    p_sender_relationship text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_owner uuid;
    v_receipt public.sifa_payment_receipts%ROWTYPE;
    v_path_prefix text;
BEGIN
    -- Validate required identifiers.
    IF p_invoice_id IS NULL
       OR p_student_user_id IS NULL THEN
        RAISE EXCEPTION 'Invoice and student are required';
    END IF;

    -- Validate currency and payment method.
    IF NOT COALESCE(
        (p_claimed_currency = 'RWF'
         AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_claimed_currency = 'TRY'
         AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_claimed_currency = 'USD'
         AND p_payment_method = 'Ziraat USD Bank Transfer'),
        false
    ) THEN
        RAISE EXCEPTION 'Invalid payment method or currency';
    END IF;

    -- Validate financial precision and storage limits.
    IF p_claimed_amount IS NULL
       OR p_claimed_amount::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR p_claimed_amount <= 0
       OR p_claimed_amount > 9999999999.99
       OR p_claimed_amount <> round(p_claimed_amount, 2)
    THEN
        RAISE EXCEPTION 'Invalid payment amount or precision';
    END IF;

    -- Validate payment sender information.
    IF p_sender_full_name IS NULL
       OR length(trim(p_sender_full_name))
          NOT BETWEEN 2 AND 150 THEN
        RAISE EXCEPTION 'A valid sender name is required';
    END IF;

    IF p_sender_relationship IS NULL
       OR p_sender_relationship NOT IN (
           'self', 'parent', 'employer', 'other'
       ) THEN
        RAISE EXCEPTION 'Invalid sender relationship';
    END IF;

    IF length(coalesce(p_sender_contact, '')) > 100 THEN
        RAISE EXCEPTION 'Sender contact is too long';
    END IF;

    IF length(coalesce(p_transaction_reference, '')) > 160 THEN
        RAISE EXCEPTION 'Transaction reference is too long';
    END IF;

    -- Validate the private receipt storage path.
    v_path_prefix :=
        'payment-receipts/' ||
        p_student_user_id::text || '/' ||
        p_invoice_id::text || '/';

    IF p_storage_path IS NULL
       OR length(p_storage_path) > 500
       OR length(p_storage_path) <= length(v_path_prefix)
       OR left(
           p_storage_path,
           length(v_path_prefix)
       ) IS DISTINCT FROM v_path_prefix
    THEN
        RAISE EXCEPTION 'Invalid private receipt storage path';
    END IF;

    -- Lock invoice before checking payment eligibility.
    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    -- Verify enrollment ownership.
    SELECT student_user_id
    INTO v_owner
    FROM public.sifa_enrollments
    WHERE id = v_invoice.enrollment_id
    FOR SHARE;

    IF NOT FOUND
       OR v_owner IS NULL
       OR v_owner IS DISTINCT FROM p_student_user_id THEN
        RAISE EXCEPTION 'Invoice does not belong to this student';
    END IF;

    -- Only eligible invoices may receive payment evidence.
    IF v_invoice.status IS NULL
       OR v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'Invoice cannot accept another receipt';
    END IF;

    -- Reject invalid invoice balances.
    IF v_invoice.amount_due IS NULL
       OR v_invoice.amount_due::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR v_invoice.amount_due <= 0 THEN
        RAISE EXCEPTION 'Invalid invoice balance';
    END IF;

    -- Direct payments require the exact invoice currency.
    IF v_invoice.currency IS DISTINCT FROM p_claimed_currency THEN
        RAISE EXCEPTION
            'An approved quote is required for cross-currency payment';
    END IF;

    -- Direct payments require the exact invoice amount.
    IF v_invoice.amount_due IS DISTINCT FROM p_claimed_amount THEN
        RAISE EXCEPTION
            'Payment amount must exactly match the invoice';
    END IF;

    -- Prevent duplicate pending or approved receipts.
    IF EXISTS (
        SELECT 1
        FROM public.sifa_payment_receipts
        WHERE invoice_id = p_invoice_id
          AND status IN ('pending_review', 'approved')
    ) THEN
        RAISE EXCEPTION
            'An existing receipt prevents another submission';
    END IF;

    -- Record payment evidence without approving payment.
    INSERT INTO public.sifa_payment_receipts (
        invoice_id,
        student_user_id,
        storage_path,
        payment_method,
        claimed_amount,
        claimed_currency,
        transaction_reference,
        sender_full_name,
        sender_contact,
        sender_relationship,
        payment_quote_id,
        status
    )
    VALUES (
        p_invoice_id,
        p_student_user_id,
        p_storage_path,
        p_payment_method,
        p_claimed_amount,
        p_claimed_currency,
        nullif(trim(p_transaction_reference), ''),
        trim(p_sender_full_name),
        nullif(trim(p_sender_contact), ''),
        p_sender_relationship,
        NULL,
        'pending_review'
    )
    RETURNING * INTO v_receipt;

    -- Update the invoice in the same database transaction.
    UPDATE public.sifa_fee_invoices
    SET status = 'receipt_submitted'
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'ok', true,
        'receipt_id', v_receipt.id,
        'status', v_receipt.status,
        'submitted_at', v_receipt.submitted_at,
        'message',
        'Receipt submitted for manual review. Payment is not yet approved.'
    );
END;
$function$;

-- Restrict execution to the trusted backend.
REVOKE ALL ON FUNCTION public.sifa_submit_payment_receipt_v2(
    uuid, uuid, text, text, numeric,
    text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sifa_submit_payment_receipt_v2(
    uuid, uuid, text, text, numeric,
    text, text, text, text, text
) TO service_role;

-- ============================================================
-- PHASE 4: Secure cross-currency payment receipt submission
-- ============================================================

CREATE OR REPLACE FUNCTION public.sifa_submit_payment_receipt_v3(
    p_invoice_id uuid,
    p_student_user_id uuid,
    p_storage_path text,
    p_payment_method text,
    p_claimed_amount numeric,
    p_claimed_currency text,
    p_transaction_reference text,
    p_sender_full_name text,
    p_sender_contact text,
    p_sender_relationship text,
    p_payment_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_quote public.sifa_payment_quotes%ROWTYPE;
    v_receipt public.sifa_payment_receipts%ROWTYPE;
    v_owner uuid;
    v_path_prefix text;
    v_now timestamptz;
BEGIN
    -- Validate required identifiers.
    IF p_invoice_id IS NULL
       OR p_student_user_id IS NULL
       OR p_payment_quote_id IS NULL THEN
        RAISE EXCEPTION
            'Invoice, student and approved quote are required';
    END IF;

    -- Validate payment amount and precision.
    IF p_claimed_amount IS NULL
       OR p_claimed_amount::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR p_claimed_amount <= 0
       OR p_claimed_amount > 9999999999.99
       OR p_claimed_amount <> round(p_claimed_amount, 2)
    THEN
        RAISE EXCEPTION 'Invalid payment amount or precision';
    END IF;

    -- Validate currency and corresponding payment method.
    IF NOT COALESCE(
        (p_claimed_currency = 'RWF'
         AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_claimed_currency = 'TRY'
         AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_claimed_currency = 'USD'
         AND p_payment_method = 'Ziraat USD Bank Transfer'),
        false
    ) THEN
        RAISE EXCEPTION 'Invalid payment method or currency';
    END IF;

    -- Validate sender information.
    IF p_sender_full_name IS NULL
       OR length(trim(p_sender_full_name))
          NOT BETWEEN 2 AND 150
       OR length(coalesce(p_sender_contact, '')) > 100
       OR p_sender_relationship IS NULL
       OR p_sender_relationship NOT IN (
           'self', 'parent', 'employer', 'other'
       )
       OR length(coalesce(p_transaction_reference, '')) > 160
    THEN
        RAISE EXCEPTION 'Invalid sender information';
    END IF;

    -- Validate private receipt storage path.
    v_path_prefix :=
        'payment-receipts/' ||
        p_student_user_id::text || '/' ||
        p_invoice_id::text || '/';

    IF p_storage_path IS NULL
       OR length(p_storage_path) > 500
       OR length(p_storage_path) <= length(v_path_prefix)
       OR left(
           p_storage_path,
           length(v_path_prefix)
       ) IS DISTINCT FROM v_path_prefix
    THEN
        RAISE EXCEPTION 'Invalid private receipt path';
    END IF;

    -- Lock invoice first.
    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    -- Verify invoice ownership.
    SELECT student_user_id
    INTO v_owner
    FROM public.sifa_enrollments
    WHERE id = v_invoice.enrollment_id
    FOR SHARE;

    IF NOT FOUND
       OR v_owner IS NULL
       OR v_owner IS DISTINCT FROM p_student_user_id THEN
        RAISE EXCEPTION 'Invoice does not belong to student';
    END IF;

    -- Verify invoice eligibility.
    IF v_invoice.status IS NULL
       OR v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'Invoice cannot accept a receipt';
    END IF;

    -- Validate invoice balance.
    IF v_invoice.amount_due IS NULL
       OR v_invoice.amount_due::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR v_invoice.amount_due <= 0 THEN
        RAISE EXCEPTION 'Invalid invoice balance';
    END IF;

    -- Same-currency payments must use the direct payment workflow.
    IF v_invoice.currency IS NOT DISTINCT FROM p_claimed_currency THEN
        RAISE EXCEPTION
            'Use the direct payment option for same-currency payments';
    END IF;

    -- Prevent duplicate payment submissions.
    IF EXISTS (
        SELECT 1
        FROM public.sifa_payment_receipts
        WHERE invoice_id = p_invoice_id
          AND status IN ('pending_review', 'approved')
    ) THEN
        RAISE EXCEPTION
            'An existing receipt prevents another submission';
    END IF;

    -- Lock the approved payment quote.
    SELECT *
    INTO v_quote
    FROM public.sifa_payment_quotes
    WHERE id = p_payment_quote_id
      AND invoice_id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment quote not found';
    END IF;

    -- Use actual time after acquiring the required locks.
    v_now := clock_timestamp();

    -- Verify quote status and approval history.
    IF v_quote.status IS DISTINCT FROM 'approved'
       OR v_quote.approved_by IS NULL
       OR v_quote.approved_at IS NULL
       OR v_quote.approved_at > v_now
       OR v_quote.valid_until IS NULL
       OR v_quote.valid_until <= v_now
    THEN
        RAISE EXCEPTION 'Payment quote is not active';
    END IF;

    -- Validate approved financial values.
    IF v_quote.payable_amount IS NULL
       OR v_quote.payable_amount::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR v_quote.payable_amount <= 0
       OR v_quote.payable_amount > 9999999999.99
       OR v_quote.exchange_rate IS NULL
       OR v_quote.exchange_rate::text IN (
           'NaN', 'Infinity', '-Infinity'
       )
       OR v_quote.exchange_rate <= 0
    THEN
        RAISE EXCEPTION 'Invalid approved financial values';
    END IF;

    -- Verify exact quote payment details.
    IF v_quote.payment_currency
           IS DISTINCT FROM p_claimed_currency
       OR v_quote.payment_method
           IS DISTINCT FROM p_payment_method
       OR v_quote.payable_amount
           IS DISTINCT FROM p_claimed_amount
    THEN
        RAISE EXCEPTION
            'Payment details do not match the approved quote';
    END IF;

    -- Revalidate conversion against current invoice balance.
    IF v_quote.payable_amount IS DISTINCT FROM
       round(v_invoice.amount_due * v_quote.exchange_rate, 2)
    THEN
        RAISE EXCEPTION
            'Approved quote no longer matches invoice balance';
    END IF;

    -- Record evidence without approving payment.
    INSERT INTO public.sifa_payment_receipts (
        invoice_id,
        student_user_id,
        storage_path,
        payment_method,
        claimed_amount,
        claimed_currency,
        transaction_reference,
        sender_full_name,
        sender_contact,
        sender_relationship,
        payment_quote_id,
        status,
        submitted_at
    )
    VALUES (
        p_invoice_id,
        p_student_user_id,
        p_storage_path,
        p_payment_method,
        p_claimed_amount,
        p_claimed_currency,
        nullif(trim(p_transaction_reference), ''),
        trim(p_sender_full_name),
        nullif(trim(p_sender_contact), ''),
        p_sender_relationship,
        p_payment_quote_id,
        'pending_review',
        v_now
    )
    RETURNING * INTO v_receipt;

    -- Update invoice in the same transaction.
    UPDATE public.sifa_fee_invoices
    SET status = 'receipt_submitted'
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'ok', true,
        'receipt_id', v_receipt.id,
        'payment_quote_id', p_payment_quote_id,
        'status', v_receipt.status,
        'submitted_at', v_receipt.submitted_at,
        'message', 'Receipt submitted for manual verification.'
    );
END;
$function$;

-- Restrict execution to the trusted backend.
REVOKE ALL ON FUNCTION public.sifa_submit_payment_receipt_v3(
    uuid, uuid, text, text, numeric,
    text, text, text, text, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sifa_submit_payment_receipt_v3(
    uuid, uuid, text, text, numeric,
    text, text, text, text, text, uuid
) TO service_role;

-- ============================================================
-- PHASE 5: Financial invoice permission hardening
-- ============================================================

-- Preserve existing Row Level Security policies.
ALTER TABLE public.sifa_fee_invoices
ENABLE ROW LEVEL SECURITY;

-- Remove unnecessary direct financial table permissions.
REVOKE ALL PRIVILEGES
ON TABLE public.sifa_fee_invoices
FROM PUBLIC, anon, authenticated;

-- Allow authenticated students and staff to read invoices
-- only when permitted by the existing RLS policies.
GRANT SELECT
ON TABLE public.sifa_fee_invoices
TO authenticated;

-- Restrict trusted backend permissions to required operations.
REVOKE ALL PRIVILEGES
ON TABLE public.sifa_fee_invoices
FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.sifa_fee_invoices
TO service_role;

-- Verify effective table privileges before allowing deployment.
DO $$
DECLARE
    v_privilege text;
BEGIN
    FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
        IF has_table_privilege(
            'anon',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Unexpected anonymous invoice privilege: %',
                v_privilege;
        END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
        IF has_table_privilege(
            'authenticated',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Unexpected authenticated invoice privilege: %',
                v_privilege;
        END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
    ]
    LOOP
        IF has_any_column_privilege(
            'anon',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Unexpected anonymous invoice column privilege: %',
                v_privilege;
        END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'REFERENCES'
    ]
    LOOP
        IF has_any_column_privilege(
            'authenticated',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Unexpected authenticated invoice column privilege: %',
                v_privilege;
        END IF;
    END LOOP;

    IF NOT has_table_privilege(
        'authenticated',
        'public.sifa_fee_invoices',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Authenticated invoice viewing must remain available';
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    ]
    LOOP
        IF NOT has_table_privilege(
            'service_role',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Required backend invoice privilege missing: %',
                v_privilege;
        END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY[
        'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
        IF has_table_privilege(
            'service_role',
            'public.sifa_fee_invoices',
            v_privilege
        ) THEN
            RAISE EXCEPTION
                'Unexpected backend invoice privilege: %',
                v_privilege;
        END IF;
    END LOOP;
END;
$$;

-- ============================================================
-- PHASE 6: Database-level duplicate invoice prevention
-- ============================================================

-- Prevent multiple non-cancelled monthly invoices
-- for the same enrollment and billing month.

CREATE UNIQUE INDEX sifa_unique_monthly_invoice
ON public.sifa_fee_invoices (
    enrollment_id,
    period_start
)
WHERE invoice_type = 'monthly_course'
  AND status <> 'cancelled';

-- Prevent multiple non-cancelled certificate invoices
-- for the same enrollment.

CREATE UNIQUE INDEX sifa_unique_certificate_invoice
ON public.sifa_fee_invoices (
    enrollment_id
)
WHERE invoice_type = 'certificate_fee'
  AND status <> 'cancelled';

-- ============================================================
-- PHASE 7: Overlapping monthly billing period protection
-- ============================================================

-- Enable GiST equality support for enrollment UUIDs.
CREATE EXTENSION IF NOT EXISTS btree_gist
WITH SCHEMA extensions;

-- Prevent overlapping non-cancelled monthly invoices
-- belonging to the same enrollment.
--
-- Preserve existing historical billing periods.
-- Both the start and end dates are inclusive.
-- Cancelled invoices remain in the financial history.

ALTER TABLE public.sifa_fee_invoices
ADD CONSTRAINT sifa_no_overlapping_monthly_invoices
EXCLUDE USING gist (
    enrollment_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
)
WHERE (
    invoice_type = 'monthly_course'
    AND status <> 'cancelled'
);

-- ============================================================
-- PHASE 8: Audit log permission hardening
-- ============================================================

-- Preserve existing audit records and staff reading policies.
ALTER TABLE public.sifa_audit_log
ENABLE ROW LEVEL SECURITY;

-- Remove unnecessary application-level permissions.
REVOKE ALL PRIVILEGES
ON TABLE public.sifa_audit_log
FROM PUBLIC, anon, authenticated, service_role;

-- Authorized staff may read audit records through RLS.
GRANT SELECT
ON TABLE public.sifa_audit_log
TO authenticated;

-- Trusted backend may read and append audit records.
GRANT SELECT, INSERT
ON TABLE public.sifa_audit_log
TO service_role;

-- Verify effective table and column privileges.
DO $$
DECLARE
    v_role text;
    v_privilege text;
    v_expected boolean;
BEGIN
    FOREACH v_role IN ARRAY ARRAY[
        'anon',
        'authenticated',
        'service_role'
    ]
    LOOP
        FOREACH v_privilege IN ARRAY ARRAY[
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
        ]
        LOOP
            v_expected :=
                (
                    v_role = 'authenticated'
                    AND v_privilege = 'SELECT'
                )
                OR
                (
                    v_role = 'service_role'
                    AND v_privilege IN ('SELECT', 'INSERT')
                );

            IF has_table_privilege(
                v_role,
                'public.sifa_audit_log',
                v_privilege
            ) IS DISTINCT FROM v_expected THEN
                RAISE EXCEPTION
                    'Unexpected audit table privilege: % - %',
                    v_role,
                    v_privilege;
            END IF;
        END LOOP;

        FOREACH v_privilege IN ARRAY ARRAY[
            'SELECT',
            'INSERT',
            'UPDATE',
            'REFERENCES'
        ]
        LOOP
            v_expected :=
                (
                    v_role = 'authenticated'
                    AND v_privilege = 'SELECT'
                )
                OR
                (
                    v_role = 'service_role'
                    AND v_privilege IN ('SELECT', 'INSERT')
                );

            IF has_any_column_privilege(
                v_role,
                'public.sifa_audit_log',
                v_privilege
            ) IS DISTINCT FROM v_expected THEN
                RAISE EXCEPTION
                    'Unexpected audit column privilege: % - %',
                    v_role,
                    v_privilege;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

COMMIT;
