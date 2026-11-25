// SIFA Global Institute — student billing
// Returns only invoices belonging to the authenticated student and their
// currently approved, unexpired payment quotes. No browser-supplied invoice IDs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origins = (Deno.env.get("SIFA_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const baseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function out(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
  status,
  headers: new Headers({
    ...baseHeaders,
    ...(origin && origins.includes(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        }
      : {}),
  }),
});
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return origin && origins.includes(origin)
      ? new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders,
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      })
      : new Response(null, { status: 403, headers: baseHeaders });
  }
  if (req.method !== "POST") return out(405, { error: "Method not allowed." }, origin);
  if (!origin || !origins.includes(origin)) return out(403, { error: "Origin not allowed." }, origin);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return out(401, { error: "Sign in first." }, origin);
  if (!url || !key) return out(503, { error: "Billing service is not configured." }, origin);

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) return out(401, { error: "Your session has expired." }, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return out(400, { error: "Invalid request." }, origin);
  }
  if (body.action !== "list_invoices") return out(400, { error: "Unknown action." }, origin);

  // The authenticated user ID, not any browser-supplied ID, controls access.
  const { data: enrollments, error: enrollmentError } = await db
    .from("sifa_enrollments")
    .select("id,program,status,start_date,end_date")
    .eq("student_user_id", userData.user.id)
    .order("created_at", { ascending: false });
  if (enrollmentError) return out(500, { error: "Could not load your enrollments." }, origin);

  const enrollmentIds = (enrollments || []).map((e) => e.id);
  if (!enrollmentIds.length) return out(200, { invoices: [], enrollments: [] }, origin);

  const { data: invoices, error: invoiceError } = await db
    .from("sifa_fee_invoices")
    .select("id,enrollment_id,period_start,period_end,invoice_type,currency,base_amount,discount_amount,amount_due,due_date,status")
    .in("enrollment_id", enrollmentIds)
    .order("period_start", { ascending: false })
    .limit(100);
  if (invoiceError) return out(500, { error: "Could not load your invoices." }, origin);

  // Return quotes only for eligible invoices owned by this student.
  const ownedInvoices = invoices || [];
  const eligibleInvoiceIds = ownedInvoices
    .filter((invoice) => ["unpaid", "overdue"].includes(invoice.status))
    .map((invoice) => invoice.id);
  const quoteByInvoice = new Map<string, Record<string, unknown>>();

  if (eligibleInvoiceIds.length) {
    const { data: quotes, error: quoteError } = await db
      .from("sifa_payment_quotes")
      .select("id,invoice_id,payment_method,payment_currency,payable_amount,valid_until")
      .in("invoice_id", eligibleInvoiceIds)
      .eq("status", "approved")
      .gt("valid_until", new Date().toISOString());

    // Fail closed: never fall back to an unverified quote.
    if (quoteError) return out(500, { error: "Could not verify approved payment options." }, origin);
    for (const quote of quotes || []) {
      quoteByInvoice.set(quote.invoice_id, {
        id: quote.id,
        payment_method: quote.payment_method,
        payment_currency: quote.payment_currency,
        payable_amount: quote.payable_amount,
        valid_until: quote.valid_until,
      });
    }
  }

  return out(200, {
    invoices: ownedInvoices.map((invoice) => ({
      ...invoice,
      payment_quote: quoteByInvoice.get(invoice.id) ?? null,
    })),
    enrollments,
  }, origin);
});
