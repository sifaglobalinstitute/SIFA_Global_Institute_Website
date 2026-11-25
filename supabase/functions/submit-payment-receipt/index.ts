// SIFA receipt submission — private evidence, quote-aware currency verification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origins = (Deno.env.get("SIFA_ALLOWED_ORIGINS") ?? "").split(",").map(s => s.trim()).filter(Boolean);
const headers = {"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
function out(status:number, body:Record<string,unknown>, origin:string|null) {
  return new Response(JSON.stringify(body),{status,headers:new Headers({
    ...headers,
    ...(origin && origins.includes(origin) ? {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"} : {})
  })});
}
const methods:Record<string,string> = {RWF:"Rwanda Mobile Money",TRY:"Ziraat Bank Transfer",USD:"Ziraat USD Bank Transfer"};
Deno.serve(async req => {
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS") return origin && origins.includes(origin) ? new Response(null,{status:204,headers:new Headers({...headers,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"})}) : new Response(null,{status:403,headers});
  if(req.method!=="POST") return out(405,{error:"Method not allowed."},origin);
  if(!origin || !origins.includes(origin)) return out(403,{error:"Origin not allowed."},origin);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return out(401,{error:"Sign in first."},origin);
  if(!url || !key) return out(503,{error:"Payment service not configured."},origin);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authErr}=await db.auth.getUser(token);
  if(authErr || !auth.user) return out(401,{error:"Session expired."},origin);
  let b: Record<string, unknown>;

try {
  const maxRequestBytes = 8_000_000;

const reader = req.body?.getReader();

if (!reader) {
  return out(400, {
    error: "Invalid request body."
  }, origin);
}

let totalBytes = 0;
const decoder = new TextDecoder("utf-8", { fatal: true });
let rawBody = "";

try {
  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    totalBytes += value.byteLength;

    if (totalBytes > maxRequestBytes) {
      await reader.cancel().catch(() => {});
      return out(413, {
        error: "Receipt is too large."
      }, origin);
    }

    rawBody += decoder.decode(value, { stream: true });
  }

  rawBody += decoder.decode();

} finally {
  reader.releaseLock();
}

const parsed: unknown = JSON.parse(rawBody);

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return out(400, {
      error: "Invalid payment request format."
    }, origin);
  }

  b = parsed as Record<string, unknown>;

} catch {
  return out(400, {
    error: "Invalid request."
  }, origin);
}
  
  const invoiceId=typeof b.invoice_id==="string"?b.invoice_id:"";
  const method=typeof b.payment_method==="string"?b.payment_method:"";
  const amount=typeof b.claimed_amount==="number"?b.claimed_amount:NaN;
  const currency=typeof b.claimed_currency==="string"?b.claimed_currency:"";
  const quoteId=typeof b.payment_quote_id==="string"?b.payment_quote_id:null;
  const ref=typeof b.transaction_reference==="string"?b.transaction_reference.trim():null;
  const senderName=typeof b.sender_full_name==="string"?b.sender_full_name.trim():"";
  const senderContact=typeof b.sender_contact==="string"?b.sender_contact.trim():"";
  const senderRelationship=typeof b.sender_relationship==="string"?b.sender_relationship.trim():"";
  const name=typeof b.name==="string"?b.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120):"receipt.pdf";
  const mime=typeof b.type==="string"?b.type:"";
  const base64=typeof b.base64==="string"?b.base64:"";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId) || !Number.isFinite(amount) || amount<=0 || amount>9999999999.99 || Number(amount.toFixed(2))!==amount || !["RWF","TRY","USD"].includes(currency) || methods[currency]!==method || !base64 ||
     senderName.length<2 || senderName.length>150 || senderContact.length>100 ||
     !["self","parent","employer","other"].includes(senderRelationship) || (ref?.length??0)>160)
    return out(400,{error:"Invalid invoice, payment, sender or receipt information."},origin);
  const {data:invoice,error:invErr}=await db.from("sifa_fee_invoices").select("id,enrollment_id,amount_due,currency,status").eq("id",invoiceId).single();
  if(invErr || !invoice) return out(404,{error:"Invoice not found or unavailable."},origin);
  const {data:enrollment,error:enErr}=await db.from("sifa_enrollments").select("student_user_id").eq("id",invoice.enrollment_id).single();
  if(enErr || !enrollment || enrollment.student_user_id!==auth.user.id) return out(404,{error:"Invoice not found or unavailable."},origin);

const invoiceAmount = Number(invoice.amount_due);

if (
  invoice.amount_due === null ||
  invoice.amount_due === undefined ||
  !Number.isFinite(invoiceAmount) ||
  invoiceAmount <= 0 ||
  invoiceAmount > 9999999999.99 ||
  Number(invoiceAmount.toFixed(2)) !== invoiceAmount ||
  !["TRY", "RWF", "USD"].includes(invoice.currency)
) {
  return out(409, {
    error: "This invoice has an invalid payable amount or currency. Contact SIFA support."
  }, origin);
}
  
  if(!["unpaid","overdue"].includes(invoice.status)) return out(409,{error:"Invoice cannot accept another receipt."},origin);
  // Always verify quote server-side before upload; the database rechecks it atomically.
  if(currency!==invoice.currency) {
    if(!quoteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quoteId)) return out(400,{error:"An approved payment quote is required for this currency."},origin);
    const {data:q,error:qe}=await db.from("sifa_payment_quotes")
      .select("id,invoice_id,payment_currency,payment_method,payable_amount,exchange_rate,status,approved_by,approved_at,valid_until")
      .eq("id",quoteId).eq("invoice_id",invoiceId).single();
    if (
  qe ||
  !q ||
  q.status !== "approved" ||
  !q.approved_by ||
  !q.approved_at ||
  !q.valid_until ||
  !Number.isFinite(Date.parse(q.approved_at)) ||
  !Number.isFinite(Date.parse(q.valid_until)) ||
  Date.parse(q.approved_at) > Date.now() ||
  Date.parse(q.valid_until) <= Date.now() ||
  Date.parse(q.valid_until) <= Date.parse(q.approved_at) ||
  !Number.isFinite(Number(q.exchange_rate)) ||
  Number(q.exchange_rate) <= 0 ||
  q.payment_currency !== currency ||
  q.payment_method !== method ||
  Number(q.payable_amount) !== amount
) {
  return out(400, {
    error: "Payment quote is invalid, expired or does not match your selected payment details."
  }, origin);
}
  } else if(quoteId) {
    return out(400,{error:"Use the invoice payment option for same-currency receipts."},origin);
  } else if(amount!==invoiceAmount) {
  return out(400,{error:"The payment amount must exactly match the invoice amount."},origin);
}
  let bytes:Uint8Array;
  try { bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)); } catch {return out(400,{error:"Could not read receipt."},origin);}
  if(!bytes.byteLength || bytes.byteLength>5*1024*1024) return out(413,{error:"Receipt must be at most 5 MB."},origin);
  const sig=Array.from(bytes.slice(0,8));const ext=name.includes(".")?name.split(".").pop()!.toLowerCase():"";
  const valid=(ext==="pdf"&&sig.slice(0,4).join(",")==="37,80,68,70"&&mime==="application/pdf") ||
    (["jpg","jpeg"].includes(ext)&&sig.slice(0,3).join(",")==="255,216,255"&&mime==="image/jpeg") ||
    (ext==="png"&&sig.slice(0,8).join(",")==="137,80,78,71,13,10,26,10"&&mime==="image/png");
  if(!valid) return out(400,{error:"Upload a valid PDF, JPG or PNG receipt."},origin);
  const path=`payment-receipts/${auth.user.id}/${invoiceId}/${crypto.randomUUID()}-${name}`;
  const {error:upErr}=await db.storage.from("sifa-private-documents").upload(path,bytes,{contentType:mime,upsert:false});
  if(upErr) return out(500,{error:"Receipt upload failed."},origin);
  const procedure=quoteId?"sifa_submit_payment_receipt_v3":"sifa_submit_payment_receipt_v2";
  const args:Record<string,unknown>={p_invoice_id:invoiceId,p_student_user_id:auth.user.id,p_storage_path:path,
    p_payment_method:method,p_claimed_amount:amount,p_claimed_currency:currency,p_transaction_reference:ref,
    p_sender_full_name:senderName,p_sender_contact:senderContact,p_sender_relationship:senderRelationship};
  if(quoteId) args.p_payment_quote_id=quoteId;
  const {data:result,error:recErr}=await db.rpc(procedure,args);
  if (recErr) {
  console.error("Receipt recording requires verification", {
    code: recErr.code,
    invoiceId,
    storagePath: path
  });

  return out(503, {
    error: "Receipt recording could not be confirmed. Refresh your payment status before submitting again. If the problem continues, contact SIFA support."
  }, origin);
}
  return out(201,result,origin);
});
