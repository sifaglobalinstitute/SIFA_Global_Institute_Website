// Authenticated student receipt submission. All files remain in a private bucket.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")??"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const origins=(Deno.env.get("SIFA_ALLOWED_ORIGINS")??"").split(",").map(s=>s.trim()).filter(Boolean);
const base={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
function out(status:number,body:Record<string,unknown>,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{...base,...(origin&&origins.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}:{})}})}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(req.method==="OPTIONS")return origin&&origins.includes(origin)?new Response(null,{status:204,headers:{...base,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}}):new Response(null,{status:403,headers:base});
 if(req.method!=="POST")return out(405,{error:"Method not allowed."},origin);
 if(!origin||!origins.includes(origin))return out(403,{error:"Origin not allowed."},origin);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""); if(!token)return out(401,{error:"Please sign in first."},origin);
 if(!url||!key)return out(503,{error:"Payment receipt service is not configured."},origin);
 let b:Record<string,unknown>;try{b=await req.json()}catch{return out(400,{error:"Invalid request."},origin)}if(JSON.stringify(b).length>8_000_000)return out(413,{error:"Receipt upload is too large."},origin)
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authErr}=await db.auth.getUser(token); if(authErr||!auth.user)return out(401,{error:"Your session has expired."},origin);
 const invoiceId=typeof b.invoice_id==="string"?b.invoice_id:"";
 const method=typeof b.payment_method==="string"?b.payment_method:"";
 const amount=Number(b.claimed_amount), currency=typeof b.claimed_currency==="string"?b.claimed_currency:"";
 const ref=typeof b.transaction_reference==="string"?b.transaction_reference.trim().slice(0,160):null;
 const name=typeof b.name==="string"?b.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120):"receipt.pdf";
 const mime=typeof b.type==="string"?b.type:"";const base64=typeof b.base64==="string"?b.base64:"";
 if(!invoiceId||! ["Rwanda Mobile Money","Ziraat Bank Transfer"].includes(method)||!Number.isFinite(amount)||amount<=0||!["RWF","TRY"].includes(currency)||!base64)return out(400,{error:"Please provide the invoice, payment method, amount, currency, and receipt file."},origin);
 const {data:invoice,error:invErr}=await db.from("sifa_fee_invoices").select("id,enrollment_id,amount_due,currency,status,sifa_enrollments!inner(student_user_id)").eq("id",invoiceId).single();
 if(invErr||!invoice)return out(404,{error:"Invoice not found."},origin);
 

if (
  !invoice.sifa_enrollments?.some(
    enrollment => enrollment.student_user_id === auth.user.id
  )
) {
  return out(403, {
    error: "You cannot submit a receipt for another student's invoice."
  }, origin);
}


 if(["paid","waived","cancelled","receipt_submitted"].includes(invoice.status))return out(409,{error:"This invoice does not accept another receipt."},origin);
 if(currency!==invoice.currency||amount<Number(invoice.amount_due))return out(400,{error:"The claimed currency must match the invoice and the amount must cover the amount due. Contact SIFA if you need help."},origin);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))}catch{return out(400,{error:"The receipt file could not be read."},origin)};
 if(bytes.byteLength<1||bytes.byteLength>5*1024*1024)return out(413,{error:"Receipt must be no larger than 5 MB."},origin);
 const sig=Array.from(bytes.slice(0,8));const ext=name.includes(".")?name.split(".").pop()!.toLowerCase():"";
 const valid=(ext==="pdf"&&sig[0]===37&&sig[1]===80&&sig[2]===68&&sig[3]===70)||( ["jpg","jpeg"].includes(ext)&&sig[0]===255&&sig[1]===216&&sig[2]===255)||(ext==="png"&&sig.slice(0,4).join(",")==="137,80,78,71");
 if(!valid||!["application/pdf","image/jpeg","image/png"].includes(mime))return out(400,{error:"Upload a valid PDF, JPG, or PNG receipt."},origin);
 const path=`payment-receipts/${auth.user.id}/${invoiceId}/${crypto.randomUUID()}-${name}`;
 const {error:upErr}=await db.storage.from("sifa-private-documents").upload(path,bytes,{contentType:mime,upsert:false});if(upErr)return out(500,{error:"Receipt upload failed. Please try again."},origin);
 
 // Record the receipt and update the invoice atomically.
 const { data: result, error: recErr } = await db.rpc(
   "sifa_submit_payment_receipt",
   {
     p_invoice_id: invoiceId,
     p_student_user_id: auth.user.id,
     p_storage_path: path,
     p_payment_method: method,
     p_claimed_amount: amount,
     p_claimed_currency: currency,
     p_transaction_reference: ref
   }
 );

 if (recErr) {
   console.error("Receipt database transaction failed", {
     code: recErr.code,
     message: recErr.message
   });

   // The database transaction failed; remove the uploaded file.
   const { error: cleanupErr } = await db.storage
     .from("sifa-private-documents")
     .remove([path]);

   if (cleanupErr) {
     console.error("Receipt cleanup failed", cleanupErr);
     return out(500, {
       error: "Receipt recording failed and the uploaded file requires staff cleanup. Please contact SIFA support before retrying."
     }, origin);
   }

   return out(409, {
     error: "The receipt could not be recorded. The invoice may already be awaiting review. Please refresh your invoices and try again if appropriate."
   }, origin);
 }

 return out(201, result, origin);
});
