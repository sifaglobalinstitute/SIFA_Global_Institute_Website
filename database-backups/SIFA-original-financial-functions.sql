-- Archived production function definitions. Not a full database backup.
-- Do not execute as a batch without review.

CREATE OR REPLACE FUNCTION public.sifa_approve_payment_quote(p_invoice_id uuid, p_payment_method text, p_payment_currency text, p_payable_amount numeric, p_exchange_rate numeric, p_valid_until timestamp with time zone, p_approval_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_quote_id uuid;
    v_admin_id uuid;
BEGIN
    -- Identify the signed-in administrator.
    v_admin_id := auth.uid();

    IF v_admin_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.sifa_staff_roles
        WHERE user_id = v_admin_id
          AND role = 'administrator'
          AND active = true
    ) THEN
        RAISE EXCEPTION 'Administrator permission required';
    END IF;

    -- Validate payment method and currency.
    IF NOT (
        (p_payment_currency = 'RWF'
         AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_payment_currency = 'TRY'
         AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_payment_currency = 'USD'
         AND p_payment_method = 'Ziraat USD Bank Transfer')
    ) THEN
        RAISE EXCEPTION 'Invalid payment method or currency';
    END IF;

    IF p_payable_amount IS NULL
       OR p_payable_amount <= 0
       OR p_payable_amount > 999999999999 THEN
        RAISE EXCEPTION 'Invalid payable amount';
    END IF;

    IF p_exchange_rate IS NULL
       OR p_exchange_rate <= 0 THEN
        RAISE EXCEPTION 'Invalid exchange rate';
    END IF;

    IF p_valid_until IS NULL
       OR p_valid_until <= now()
       OR p_valid_until > now() + interval '7 days' THEN
        RAISE EXCEPTION 'Quote validity must be within 7 days';
    END IF;

    IF p_approval_note IS NULL
       OR length(trim(p_approval_note)) < 10
       OR length(p_approval_note) > 1000 THEN
        RAISE EXCEPTION 'A detailed approval note is required';
    END IF;

    -- Lock and validate the invoice.
    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'Invoice is not eligible for payment';
    END IF;

    -- Ensure the approved amount matches the recorded rate.
    -- Rate means payment currency units per invoice currency unit.
    IF abs(
        p_payable_amount -
        round(v_invoice.amount_due * p_exchange_rate, 2)
    ) > 0.01 THEN
        RAISE EXCEPTION 'Amount does not match the exchange rate';
    END IF;

    -- Do not apply conversion to the same currency.
    IF v_invoice.currency = p_payment_currency
       AND (
           p_exchange_rate <> 1
           OR p_payable_amount <> v_invoice.amount_due
       ) THEN
        RAISE EXCEPTION 'Same-currency quote must match invoice';
    END IF;

    -- Never silently replace an existing approved quote.
    IF EXISTS (
        SELECT 1
        FROM public.sifa_payment_quotes
        WHERE invoice_id = p_invoice_id
          AND status = 'approved'
    ) THEN
        RAISE EXCEPTION
          'An approved quote already exists for this invoice';
    END IF;

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
        now(),
        p_valid_until,
        trim(p_approval_note)
    )
    RETURNING id INTO v_quote_id;

    RETURN v_quote_id;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.sifa_submit_payment_receipt_v2(p_invoice_id uuid, p_student_user_id uuid, p_storage_path text, p_payment_method text, p_claimed_amount numeric, p_claimed_currency text, p_transaction_reference text, p_sender_full_name text, p_sender_contact text, p_sender_relationship text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_owner uuid;
    v_receipt public.sifa_payment_receipts%ROWTYPE;
BEGIN
    -- Validate payment information.
    IF p_invoice_id IS NULL OR p_student_user_id IS NULL THEN
        RAISE EXCEPTION 'Invoice and student are required';
    END IF;

    IF p_claimed_currency IS NULL
       OR p_claimed_currency NOT IN ('TRY', 'RWF', 'USD') THEN
        RAISE EXCEPTION 'Invalid payment currency';
    END IF;

    -- Each currency must use its approved payment method.
    IF NOT (
        (p_claimed_currency = 'RWF'
          AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_claimed_currency = 'TRY'
          AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_claimed_currency = 'USD'
          AND p_payment_method = 'Ziraat USD Bank Transfer')
    ) THEN
        RAISE EXCEPTION 'Payment method does not match currency';
    END IF;

    IF p_claimed_amount IS NULL
       OR p_claimed_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount';
    END IF;

    -- Validate sender information.
    IF p_sender_full_name IS NULL
       OR length(trim(p_sender_full_name)) < 2
       OR length(trim(p_sender_full_name)) > 150 THEN
        RAISE EXCEPTION 'A valid sender name is required';
    END IF;

    IF p_sender_relationship IS NULL
       OR p_sender_relationship NOT IN
          ('self', 'parent', 'employer', 'other') THEN
        RAISE EXCEPTION 'Invalid sender relationship';
    END IF;

    IF length(coalesce(p_sender_contact, '')) > 100 THEN
        RAISE EXCEPTION 'Sender contact is too long';
    END IF;

    IF length(coalesce(p_transaction_reference, '')) > 160 THEN
        RAISE EXCEPTION 'Transaction reference is too long';
    END IF;

    -- Receipt must be in the correct private storage location.
    IF p_storage_path IS NULL
       OR length(p_storage_path) > 500
       OR p_storage_path NOT LIKE
          ('payment-receipts/' || p_student_user_id::text
           || '/' || p_invoice_id::text || '/%') THEN
        RAISE EXCEPTION 'Invalid receipt storage path';
    END IF;

    -- Lock the invoice to prevent concurrent submissions.
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
    WHERE id = v_invoice.enrollment_id;

    IF v_owner IS NULL OR v_owner <> p_student_user_id THEN
        RAISE EXCEPTION 'Invoice does not belong to this student';
    END IF;

    IF v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'This invoice cannot accept another receipt';
    END IF;

    IF v_invoice.currency <> p_claimed_currency
       OR p_claimed_amount < v_invoice.amount_due THEN
        RAISE EXCEPTION 'Receipt amount or currency does not match invoice';
    END IF;

    -- Record payment evidence and sender information.
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
        'pending_review'
    )
    RETURNING * INTO v_receipt;

    -- Update the invoice in the same transaction.
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

CREATE OR REPLACE FUNCTION public.sifa_submit_payment_receipt_v3(p_invoice_id uuid, p_student_user_id uuid, p_storage_path text, p_payment_method text, p_claimed_amount numeric, p_claimed_currency text, p_transaction_reference text, p_sender_full_name text, p_sender_contact text, p_sender_relationship text, p_payment_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.sifa_fee_invoices%ROWTYPE;
    v_quote public.sifa_payment_quotes%ROWTYPE;
    v_owner uuid;
    v_receipt public.sifa_payment_receipts%ROWTYPE;
BEGIN
    IF p_invoice_id IS NULL
       OR p_student_user_id IS NULL
       OR p_payment_quote_id IS NULL THEN
        RAISE EXCEPTION 'Invoice, student and approved quote are required';
    END IF;

    IF p_claimed_amount IS NULL
       OR p_claimed_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount';
    END IF;

    IF p_claimed_currency NOT IN ('TRY', 'RWF', 'USD')
       OR p_claimed_currency IS NULL THEN
        RAISE EXCEPTION 'Invalid currency';
    END IF;

    IF NOT (
        (p_claimed_currency = 'RWF'
         AND p_payment_method = 'Rwanda Mobile Money')
        OR
        (p_claimed_currency = 'TRY'
         AND p_payment_method = 'Ziraat Bank Transfer')
        OR
        (p_claimed_currency = 'USD'
         AND p_payment_method = 'Ziraat USD Bank Transfer')
    ) THEN
        RAISE EXCEPTION 'Payment method does not match currency';
    END IF;

    IF p_sender_full_name IS NULL
       OR length(trim(p_sender_full_name)) NOT BETWEEN 2 AND 150
       OR length(coalesce(p_sender_contact, '')) > 100
       OR p_sender_relationship IS NULL
       OR p_sender_relationship NOT IN
           ('self', 'parent', 'employer', 'other')
       OR length(coalesce(p_transaction_reference, '')) > 160
    THEN
        RAISE EXCEPTION 'Invalid sender information';
    END IF;

    IF p_storage_path IS NULL
       OR length(p_storage_path) > 500
       OR left(
           p_storage_path,
           length(
             'payment-receipts/' ||
             p_student_user_id::text || '/' ||
             p_invoice_id::text || '/'
           )
       ) <> (
           'payment-receipts/' ||
           p_student_user_id::text || '/' ||
           p_invoice_id::text || '/'
       )
       OR length(p_storage_path) <= length(
           'payment-receipts/' ||
           p_student_user_id::text || '/' ||
           p_invoice_id::text || '/'
       )
    THEN
        RAISE EXCEPTION 'Invalid private receipt path';
    END IF;

    -- Lock invoice before checking eligibility.
    SELECT *
    INTO v_invoice
    FROM public.sifa_fee_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    SELECT student_user_id
    INTO v_owner
    FROM public.sifa_enrollments
    WHERE id = v_invoice.enrollment_id;

    IF v_owner IS DISTINCT FROM p_student_user_id THEN
        RAISE EXCEPTION 'Invoice does not belong to student';
    END IF;

    IF v_invoice.status NOT IN ('unpaid', 'overdue') THEN
        RAISE EXCEPTION 'Invoice cannot accept a receipt';
    END IF;

    -- Lock and verify the staff-approved payment quote.
    SELECT *
    INTO v_quote
    FROM public.sifa_payment_quotes
    WHERE id = p_payment_quote_id
      AND invoice_id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment quote not found';
    END IF;

    IF v_quote.status <> 'approved'
       OR v_quote.valid_until IS NULL
       OR v_quote.valid_until <= now()
    THEN
        RAISE EXCEPTION 'Payment quote is not active';
    END IF;

    IF v_quote.payment_currency IS DISTINCT FROM p_claimed_currency
       OR v_quote.payment_method IS DISTINCT FROM p_payment_method
       OR v_quote.payable_amount IS DISTINCT FROM p_claimed_amount
    THEN
        RAISE EXCEPTION 'Payment details do not match the approved quote';
    END IF;

    -- Record evidence; never approve payment automatically.
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
        p_payment_quote_id,
        'pending_review'
    )
    RETURNING * INTO v_receipt;

    UPDATE public.sifa_fee_invoices
    SET status = 'receipt_submitted'
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'ok', true,
        'receipt_id', v_receipt.id,
        'payment_quote_id', p_payment_quote_id,
        'status', 'pending_review',
        'message', 'Receipt submitted for manual verification.'
    );
END;
$function$;
