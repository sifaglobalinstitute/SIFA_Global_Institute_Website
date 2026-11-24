// SIFA staff-only workflow API. Deploy with Supabase CLI; never expose service role key to browsers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const allowedOrigins = [
  ...new Set([
    ...(Deno.env.get("SIFA_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean),

    "https://sifaglobalinstitute.pages.dev",
    "http://127.0.0.1:5500"
  ])
];

const base = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
function response(status:number, body:Record<string,unknown>, origin:string|null) {
  return new Response(JSON.stringify(body), {status, headers:{...base, ...(origin && allowedOrigins.includes(origin) ? {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}: {})}});
}
const clean=(v:unknown,n=1000)=>typeof v === "string" ? v.trim().slice(0,n) : "";
Deno.serve(async req => {
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS") return origin && allowedOrigins.includes(origin) ? new Response(null,{status:204,headers:{...base,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}}) : new Response(null,{status:403,headers:base});
  if(req.method!=="POST") return response(405,{error:"Method not allowed."},origin);
  if(!origin || !allowedOrigins.includes(origin)) return response(403,{error:"Origin not allowed."},origin);
  if(!url || !serviceKey) return response(503,{error:"Service not configured."},origin);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return response(401,{error:"Sign in with an authorized SIFA staff account."},origin);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError || !userData.user) return response(401,{error:"Your session is invalid or expired. Sign in again."},origin);
  const userId=userData.user.id;
  const {data:role,error:roleError}=await admin.from("sifa_staff_roles").select("role,active").eq("user_id",userId).eq("active",true).maybeSingle();
  if(roleError || !role) return response(403,{error:"This account has no active SIFA staff role."},origin);
  let body:Record<string,unknown>;
  try { body=await req.json(); } catch { return response(400,{error:"Invalid request."},origin); }
  const action=clean(body.action,80);
  const isAny=(...roles:string[])=>roles.includes(role.role);
  
const audit = async (
  actionName: string,
  type: string,
  id: string | null,
  after: unknown,
  reason: string | null = null
) => {
  const { error } = await admin
    .from("sifa_audit_log")
    .insert({
      actor_user_id: userId,
      action: actionName,
      entity_type: type,
      entity_id: id,
      before_data: null,
      after_data: after ?? null,
      reason
    });

  if (error) {
    console.error("SIFA audit logging failed:", error.message);
    throw new Error("Audit logging failed");
  }
};

  try {
    if(action==="whoami") return response(200,{role:role.role,active:role.active},origin);

    // Approve a payment quote using the signed-in administrator.
    if (action === "approve_payment_quote") {
      if (!isAny("administrator")) {
        return response(403, {
          error: "Administrator permission required."
        }, origin);
      }

      const invoiceId = clean(body.invoice_id, 80);
      const currency = clean(body.payment_currency, 3);
      const method = clean(body.payment_method, 80);
      const note = clean(body.approval_note, 1001);
      const validUntil = clean(body.valid_until, 50);

      const amount = body.payable_amount;
      const rate = body.exchange_rate;

      const methods: Record<string, string> = {
        RWF: "Rwanda Mobile Money",
        TRY: "Ziraat Bank Transfer",
        USD: "Ziraat USD Bank Transfer"
      };

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId) ||
        methods[currency] !== method ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        note.length < 10 ||
        note.length > 1000 ||
        !validUntil ||
        Number.isNaN(Date.parse(validUntil))
      ) {
        return response(400, {
          error: "Provide a valid invoice, payment method, amount, exchange rate, expiry and approval note."
        }, origin);
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

      if (!anonKey) {
        return response(503, {
          error: "Authenticated approval service is not configured."
        }, origin);
      }

      // Use the administrator's JWT so auth.uid() is correct.
      const staffClient = createClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      });

      const { data: quoteId, error: quoteError } =
        await staffClient.rpc("sifa_approve_payment_quote", {
          p_invoice_id: invoiceId,
          p_payment_method: method,
          p_payment_currency: currency,
          p_payable_amount: amount,
          p_exchange_rate: rate,
          p_valid_until: validUntil,
          p_approval_note: note
        });

      if (quoteError) {
        console.error("Payment quote approval failed:", quoteError.message);

        return response(409, {
          error: "Quote approval was not completed. Check the invoice, amount, exchange rate, and existing approvals."
        }, origin);
      }

      await audit(
        "payment_quote_approved",
        "payment_quote",
        quoteId,
        {
          invoice_id: invoiceId,
          payment_currency: currency,
          payment_method: method,
          payable_amount: amount,
          exchange_rate: rate,
          valid_until: validUntil
        },
        note
      );

      return response(201, {
        ok: true,
        quote_id: quoteId,
        message: "Payment quote approved. No payment has been confirmed."
      }, origin);
    }

    if(action==="list_applications") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const {data,error}=await admin.from("sifa_public_applications").select("id,application_ref,full_name,email,phone,country,program,status,payload,submitted_at,updated_at,decided_at,decision_reason").order("submitted_at",{ascending:false}).limit(200);
      if(error) throw error; return response(200,{items:data},origin);
    }
    if(action==="list_application_documents") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.application_id,80);if(!id)return response(400,{error:"Application ID is required."},origin);
      const {data,error}=await admin.from("sifa_application_documents").select("id,original_filename,content_type,byte_size,uploaded_at").eq("public_application_id",id).order("uploaded_at",{ascending:false});if(error)throw error;return response(200,{items:data},origin);
    }
    if(action==="decide_application") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.id,80), status=clean(body.status,40), reason=clean(body.reason,2000);
      if(!id || !["Under Review","Needs Information","Accepted","Rejected"].includes(status)) return response(400,{error:"Invalid application decision."},origin);
      const {data,error}=await admin.from("sifa_public_applications").update({status,decision_reason:reason||null,decided_by:userId,decided_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).select("id,application_ref,status,decided_at").single();
      if(error) throw error; await audit("application_decision","public_application",id,data,reason||null); return response(200,{ok:true,item:data},origin);
    }
    if(action==="list_receipts") {
      if(!isAny("administrator","finance_reviewer")) return response(403,{error:"Finance reviewer or administrator role required."},origin);
      const {data,error}=await admin.from("sifa_payment_receipts").select("id,invoice_id,student_user_id,storage_path,payment_method,claimed_amount,claimed_currency,transaction_reference,status,submitted_at").order("submitted_at",{ascending:false}).limit(200);
      if(error) throw error; return response(200,{items:data},origin);
    }
    if(action==="get_receipt_url") {
      if(!isAny("administrator","finance_reviewer")) return response(403,{error:"Finance reviewer or administrator role required."},origin);
      const id=clean(body.id,80);if(!id)return response(400,{error:"Receipt ID is required."},origin);
      const {data:receipt,error}=await admin.from("sifa_payment_receipts").select("id,storage_path,submitted_at").eq("id",id).single();if(error)throw error;
      const {data:link,error:linkError}=await admin.storage.from("sifa-private-documents").createSignedUrl(receipt.storage_path,60);if(linkError)throw linkError;
      await audit("payment_receipt_access","payment_receipt",id,{submitted_at:receipt.submitted_at});return response(200,{url:link.signedUrl,expires_in_seconds:60},origin);
    }
    if(action==="review_receipt") {
      if(!isAny("administrator","finance_reviewer")) return response(403,{error:"Finance reviewer or administrator role required."},origin);
      const id=clean(body.id,80), status=clean(body.status,20), note=clean(body.note,2000);
      if(!id || !["approved","rejected"].includes(status)) return response(400,{error:"Invalid receipt decision."},origin);
      const {data:receipt,error:receiptError}=await admin.from("sifa_payment_receipts").select("id,invoice_id,status").eq("id",id).single(); if(receiptError) throw receiptError;
      if(receipt.status!=="pending_review") return response(409,{error:"This receipt has already been reviewed."},origin);
      const {data,error}=await admin.rpc("sifa_review_payment_receipt",{p_receipt_id:id,p_status:status,p_reviewer:userId,p_note:note||null});if(error)throw error;
      return response(200,{ok:true,item:data},origin);
    }
    if(action==="decide_scholarship") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.id,80), decision=clean(body.decision,20), percent=Number(body.monthly_discount_percent), reason=clean(body.reason,2000);
      if(!id || !["approved","rejected","withdrawn"].includes(decision) || !Number.isFinite(percent) || percent<0 || percent>100 || (decision!=="approved" && percent!==0)) return response(400,{error:"Invalid scholarship decision. Discounts apply to monthly fees only."},origin);
      const startsOn=clean(body.starts_on,10)||null, endsOn=clean(body.ends_on,10)||null;if(startsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)||endsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)||startsOn&&endsOn&&endsOn<startsOn)return response(400,{error:"Scholarship start/end dates are invalid."},origin);
      const {data,error}=await admin.from("sifa_scholarship_decisions").update({decision,monthly_discount_percent:percent,starts_on:startsOn,ends_on:endsOn,reason:reason||null,decided_by:userId,decided_at:new Date().toISOString()}).eq("id",id).select("id,decision,monthly_discount_percent,starts_on,ends_on,decided_at").single();
      if(error) throw error; await audit("scholarship_decision","scholarship",id,data,reason||null); return response(200,{ok:true,item:data},origin);
    }
    if(action==="create_certificate_invoice") {
      if(!isAny("administrator","finance_reviewer")) return response(403,{error:"Finance reviewer or administrator role required."},origin);
      const enrollmentId=clean(body.enrollment_id,80);if(!enrollmentId)return response(400,{error:"Enrollment ID is required."},origin);
      const {data:enrollment,error:eErr}=await admin.from("sifa_enrollments").select("id,status").eq("id",enrollmentId).single();if(eErr)throw eErr;if(enrollment.status!=="completed")return response(409,{error:"The certificate fee can only be invoiced after course completion."},origin);
      const {data:prior,error:priorErr}=await admin.from("sifa_fee_invoices").select("id,status").eq("enrollment_id",enrollmentId).eq("invoice_type","certificate_fee").not("status","eq","cancelled").limit(1).maybeSingle();if(priorErr)throw priorErr;if(prior)return response(409,{error:`A certificate fee invoice already exists (${prior.status}). Use that invoice rather than creating a duplicate.`},origin);
      const today=new Date().toISOString().slice(0,10);const {data,error}=await admin.from("sifa_fee_invoices").insert({enrollment_id:enrollmentId,period_start:today,period_end:today,invoice_type:"certificate_fee",currency:"RWF",base_amount:5000,discount_amount:0,due_date:today,status:"unpaid"}).select("id,enrollment_id,invoice_type,currency,base_amount,amount_due,due_date,status").single();if(error)throw error;await audit("certificate_fee_invoice_created","fee_invoice",data.id,data);return response(201,{ok:true,item:data},origin);
    }
    if(action==="issue_certificate") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const enrollmentId=clean(body.enrollment_id,80), name=clean(body.student_display_name,160), program=clean(body.program,160), code=clean(body.certificate_code,80).toUpperCase();
      if(!enrollmentId||!name||!program||!/^SIFA-[A-Z0-9-]{6,70}$/.test(code)) return response(400,{error:"Provide a valid enrollment, student name, program, and SIFA certificate code."},origin);
      const {data:enrollment,error:eErr}=await admin.from("sifa_enrollments").select("id,status").eq("id",enrollmentId).single(); if(eErr) throw eErr;
      if(enrollment.status!=="completed") return response(409,{error:"Certificate can only be issued for a completed enrollment."},origin);
      const {data:fee,error:feeErr}=await admin.from("sifa_fee_invoices").select("id,status").eq("enrollment_id",enrollmentId).eq("invoice_type","certificate_fee").eq("status","paid").limit(1).maybeSingle();if(feeErr)throw feeErr;if(!fee)return response(409,{error:"The optional 5,000 RWF certificate fee must be paid and verified before issuing a certificate."},origin);
      const {data,error}=await admin.from("sifa_certificate_registry").insert({certificate_code:code,enrollment_id:enrollmentId,student_display_name:name,program,issued_by:userId}).select("certificate_code,student_display_name,program,issued_on,status").single();
      if(error) throw error; await audit("certificate_issued","certificate",null,data); return response(201,{ok:true,item:data},origin);
    }
    if(action==="list_certificates") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const {data,error}=await admin.from("sifa_certificate_registry").select("id,certificate_code,student_display_name,program,issued_on,status,revoked_at,revocation_reason,created_at").order("created_at",{ascending:false}).limit(200);if(error)throw error;return response(200,{items:data},origin);
    }
    if(action==="revoke_certificate") {
      if(!isAny("administrator")) return response(403,{error:"Administrator role required."},origin);
      const id=clean(body.id,80), reason=clean(body.reason,2000); if(!id||reason.length<5) return response(400,{error:"Certificate ID and a reason are required."},origin);
      const {data,error}=await admin.from("sifa_certificate_registry").update({status:"revoked",revoked_at:new Date().toISOString(),revocation_reason:reason}).eq("id",id).eq("status","active").select("id,certificate_code,status,revoked_at").single(); if(error) throw error;
      await audit("certificate_revoked","certificate",id,data,reason); return response(200,{ok:true,item:data},origin);
    }
    if(action==="link_application_user") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.id,80);if(!id)return response(400,{error:"Application ID is required."},origin);
      const {data:app,error:appErr}=await admin.from("sifa_public_applications").select("id,email,application_ref,status,linked_user_id").eq("id",id).single();if(appErr)throw appErr;
      let foundUser: {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
} | null = null;
      
for (let page = 1; page <= 10; page++) {
  const { data, error } = await admin.auth.admin.listUsers({
    page,
    perPage: 1000
  });

  if (error) throw error;

  foundUser = (data.users || []).find(
    (u: {
      id: string;
      email?: string;
      email_confirmed_at?: string | null;
    }) => (u.email || "").toLowerCase() === app.email.toLowerCase()
  ) || null;

  if (foundUser || (data.users || []).length < 1000) {
    break;
  }
}

      if(!foundUser)return response(404,{error:"No registered student account matches this application email yet. Ask the applicant to create and verify their Student Portal account, then retry."},origin);
      if(!foundUser.email_confirmed_at)return response(409,{error:"The matching Student Portal account has not verified its email address yet."},origin);
      const {data,error}=await admin.from("sifa_public_applications").update({linked_user_id:foundUser.id,updated_at:new Date().toISOString()}).eq("id",id).select("id,application_ref,email,linked_user_id").single();if(error)throw error;
      await audit("application_account_linked","public_application",id,{linked_user_id:foundUser.id});return response(200,{ok:true,item:data},origin);
    }
    if(action==="create_enrollment") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.application_id,80), startDate=clean(body.start_date,10);if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(startDate))return response(400,{error:"Application ID and valid start date are required."},origin);
      const {data:app,error:appErr}=await admin.from("sifa_public_applications").select("id,linked_user_id,program,status").eq("id",id).single();if(appErr)throw appErr;
      if(app.status!=="Accepted")return response(409,{error:"Only accepted applications can become enrollments."},origin);if(!app.linked_user_id)return response(409,{error:"Link the applicant's verified Student Portal account first."},origin);
      const {data:existing,error:existingErr}=await admin.from("sifa_enrollments").select("id").eq("public_application_id",id).maybeSingle();if(existingErr)throw existingErr;if(existing)return response(409,{error:"An enrollment already exists for this application."},origin);
      const start=new Date(`${startDate}T00:00:00Z`);const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+3,start.getUTCDate()-1));
      const {data,error}=await admin.from("sifa_enrollments").insert({student_user_id:app.linked_user_id,public_application_id:id,program:app.program,status:"pending_payment",start_date:startDate,end_date:end.toISOString().slice(0,10)}).select("id,student_user_id,public_application_id,program,status,start_date,end_date").single();if(error)throw error;
      await audit("enrollment_created","enrollment",data.id,data);return response(201,{ok:true,item:data},origin);
    }
    if(action==="list_enrollments") {
      if(!isAny("administrator","coordinator","finance_reviewer")) return response(403,{error:"Authorized staff role required."},origin);
      const {data,error}=await admin.from("sifa_enrollments").select("id,student_user_id,public_application_id,application_id,program,status,start_date,end_date,created_at").order("created_at",{ascending:false}).limit(200);if(error)throw error;return response(200,{items:data},origin);
    }
    if(action==="authorize_access_exception") {
      if(!isAny("administrator")) return response(403,{error:"Administrator role required for an access exception."},origin);
      const id=clean(body.id,80), reason=clean(body.reason,1000), expires=clean(body.expires_at,40);const expiresAt=new Date(expires);
      if(!id||reason.length<8||!expires||Number.isNaN(expiresAt.getTime())||expiresAt<=new Date()||expiresAt>new Date(Date.now()+31*86400000))return response(400,{error:"Provide an enrollment, a reason of at least 8 characters, and an expiry within the next 31 days."},origin);
      const {data:existing,error:existingErr}=await admin.from("sifa_enrollments").select("status").eq("id",id).single();if(existingErr)throw existingErr;if(["completed","withdrawn"].includes(existing.status))return response(409,{error:"A completed or withdrawn enrollment cannot receive a temporary access exception."},origin);
      const {data,error}=await admin.from("sifa_enrollments").update({status:"active",access_exception_reason:reason,access_exception_approved_by:userId,access_exception_expires_at:expiresAt.toISOString(),updated_at:new Date().toISOString()}).eq("id",id).select("id,status,program,access_exception_reason,access_exception_expires_at").single();if(error)throw error;
      await audit("temporary_access_exception_authorized","enrollment",id,data,reason);return response(200,{ok:true,item:data},origin);
    }
    if(action==="set_enrollment_status") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.id,80), status=clean(body.status,30), reason=clean(body.reason,1000);if(!id||!["active","suspended","completed","withdrawn"].includes(status))return response(400,{error:"Invalid enrollment status."},origin);
      if(status==="active"){
        const today=new Date().toISOString().slice(0,10);
        const {data:paidInvoice,error:paidErr}=await admin.from("sifa_fee_invoices").select("id").eq("enrollment_id",id).eq("invoice_type","monthly_course").in("status",["paid","waived"]).lte("period_start",today).gte("period_end",today).limit(1).maybeSingle();if(paidErr)throw paidErr;
        if(!paidInvoice)return response(409,{error:"Activation requires a verified paid or valid waived monthly invoice for the current period. Use the separate time-limited administrator exception only when explicitly authorized."},origin);
      }
      const patch:Record<string,unknown>={status,updated_at:new Date().toISOString()};if(status==="active"){patch.access_exception_reason=null;patch.access_exception_approved_by=null;patch.access_exception_expires_at=null;}
      const {data,error}=await admin.from("sifa_enrollments").update(patch).eq("id",id).select("id,status,program").single();if(error)throw error;await audit("enrollment_status_changed","enrollment",id,data,reason||null);return response(200,{ok:true,item:data},origin);
    }
    if(action==="list_scholarships") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const {data,error}=await admin.from("sifa_scholarship_decisions").select("id,public_application_id,application_id,decision,monthly_discount_percent,starts_on,ends_on,reason,created_at,decided_at").order("created_at",{ascending:false}).limit(200);
      
if (error) throw error;

type ScholarshipRecord = {
  public_application_id: string | null;
  [key: string]: unknown;
};

type ApplicationRecord = {
  id: string;
  [key: string]: unknown;
};

const scholarships = (data || []) as ScholarshipRecord[];

const ids = scholarships
  .map(x => x.public_application_id)
  .filter((id): id is string => Boolean(id));

let apps: ApplicationRecord[] = [];

if (ids.length) {
  const { data: applicationRows, error: applicationError } = await admin
    .from("sifa_public_applications")
    .select("id,application_ref,full_name,email,program,status,payload")
    .in("id", ids);

  if (applicationError) throw applicationError;

  apps = (applicationRows || []) as ApplicationRecord[];
}

const byId = new Map(apps.map(a => [a.id, a]));

return response(
  200,
  {
    items: scholarships.map(x => ({
      ...x,
      applicant: byId.get(x.public_application_id || "") || null
    }))
  },
  origin
);

    }
    if(action==="create_monthly_invoice") {
      if(!isAny("administrator","finance_reviewer")) return response(403,{error:"Finance reviewer or administrator role required."},origin);
      const enrollmentId=clean(body.enrollment_id,80), periodStart=clean(body.period_start,10), currency=clean(body.currency,3), amount=Number(body.base_amount);
      if(!enrollmentId||!/^\d{4}-\d{2}-01$/.test(periodStart)||! ["RWF","TRY"].includes(currency)||!Number.isFinite(amount)||amount<=0) return response(400,{error:"Provide a valid enrollment, first-of-month period start, currency, and positive amount."},origin);
      const start=new Date(`${periodStart}T00:00:00Z`);const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0));const periodEnd=end.toISOString().slice(0,10);
      const {data:enrollment,error:eErr}=await admin.from("sifa_enrollments").select("id,status,start_date,end_date").eq("id",enrollmentId).single();if(eErr)throw eErr;if(!["active","suspended","pending_payment"].includes(enrollment.status))return response(409,{error:"Enrollment is not eligible for a monthly invoice."},origin);if(enrollment.start_date&&periodEnd<enrollment.start_date||enrollment.end_date&&periodStart>enrollment.end_date)return response(400,{error:"The invoice month must overlap the enrollment dates."},origin);
      const dueDate=periodStart;
      const {data:enr,error:enrErr}=await admin.from("sifa_enrollments").select("public_application_id,application_id").eq("id",enrollmentId).single();if(enrErr)throw enrErr;
      let discountPercent=0;const appField=enr.public_application_id?"public_application_id":"application_id";const appId=enr.public_application_id||enr.application_id;
      if(appId){const {data:sch,error:schErr}=await admin.from("sifa_scholarship_decisions").select("monthly_discount_percent,starts_on,ends_on").eq(appField,appId).eq("decision","approved").order("decided_at",{ascending:false}).limit(1).maybeSingle();if(schErr)throw schErr;if(sch&&(!sch.starts_on||sch.starts_on<=periodStart)&&(!sch.ends_on||sch.ends_on>=periodStart))discountPercent=Number(sch.monthly_discount_percent)||0;}
      const discount=Math.round(amount*discountPercent)/100;
      const {data,error}=await admin.from("sifa_fee_invoices").insert({enrollment_id:enrollmentId,period_start:periodStart,period_end:periodEnd,currency,base_amount:amount,discount_amount:discount,due_date:dueDate,status:discount>=amount?"waived":"unpaid"}).select("id,enrollment_id,period_start,period_end,invoice_type,currency,base_amount,discount_amount,amount_due,due_date,status").single();
      if(error)throw error;await audit("monthly_invoice_created","fee_invoice",data.id,data);return response(201,{ok:true,item:data},origin);
    }
    if(action==="get_document_url") {
      if(!isAny("administrator","coordinator")) return response(403,{error:"Coordinator or administrator role required."},origin);
      const id=clean(body.id,80);if(!id)return response(400,{error:"Document ID is required."},origin);
      const {data:doc,error}=await admin.from("sifa_application_documents").select("id,storage_bucket,storage_path,original_filename,content_type,byte_size,public_application_id,existing_application_id").eq("id",id).single();if(error)throw error;
      const {data:app,error:appError}=doc.public_application_id?await admin.from("sifa_public_applications").select("status").eq("id",doc.public_application_id).single():{data:null,error:null};if(appError)throw appError;
      const {data:link,error:linkError}=await admin.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path,60,{download:doc.original_filename});if(linkError)throw linkError;
      await audit("application_document_access","application_document",id,{filename:doc.original_filename,application_id:doc.public_application_id});return response(200,{url:link.signedUrl,filename:doc.original_filename,content_type:doc.content_type,application_status:app?.status??null,expires_in_seconds:60},origin);
    }
    return response(400,{error:"Unknown action."},origin);
  } catch(err) {
    console.error("SIFA staff action failed",{action,code:(err as {code?:string})?.code,message:err instanceof Error?err.message:"unknown"});
    return response(500,{error:"The requested operation could not be completed. Check the workflow schema and staff permissions."},origin);
  }
});
