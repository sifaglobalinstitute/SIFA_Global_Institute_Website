// SIFA public application intake — deploy as a Supabase Edge Function.
// Required server-side secrets/config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SIFA_APPLICATIONS_OPEN (must be "true" to accept submissions),
// SIFA_ALLOWED_ORIGINS (comma-separated exact origins).
// Never expose SUPABASE_SERVICE_ROLE_KEY in browser files or GitHub.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = (Deno.env.get("SIFA_ALLOWED_ORIGINS") ?? "")
  .split(",").map((v) => v.trim()).filter(Boolean);
const headersBase = { "Vary": "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  const originAllowed = !!origin && allowedOrigins.includes(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headersBase,
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } : {}),
    },
  });
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const occupations = new Set(["Student", "Recent graduate", "Job seeker", "Unemployed", "Intern / Trainee", "Teacher / Lecturer", "Researcher", "Accountant", "Bookkeeper", "Auditor", "Financial analyst", "Finance manager", "Banking professional", "Tax professional", "Cashier", "Payroll officer", "Business owner", "Entrepreneur", "Self-employed", "Managing director / CEO", "General manager", "Operations manager", "Project manager", "Human resources professional", "Secretary", "Administrative assistant", "Sales professional", "Marketing professional", "Procurement officer", "IT professional", "Software developer", "Data analyst", "Engineer", "Healthcare professional", "Farmer / Agricultural professional", "Agribusiness owner", "Retail worker", "Manufacturing worker", "Construction worker", "Transport / Logistics professional", "Hospitality professional", "Government employee", "NGO / Nonprofit worker", "Consultant", "Freelancer", "Other"]);
const required = ["identityDocument","educationCertificate","photo"];
const optional = ["transcript","cv","certificates","workDocuments","otherDocument"];
const mimeTypes: Record<string,string> = {pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
Deno.serve(async (req) => {
 const origin=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response(null,{status:origin&&allowedOrigins.includes(origin)?204:403,headers:{...headersBase,...(origin&&allowedOrigins.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"}:{})}});
 if(req.method!=="POST")return json(405,{error:"Method not allowed."},origin);
 if(!origin||!allowedOrigins.includes(origin))return json(403,{error:"Origin not allowed."},origin);
 if(!url||!serviceKey)return json(503,{error:"Application service unavailable."},origin);
 try{
 const token=/^Bearer (\S+)$/i.exec(req.headers.get("authorization")??"")?.[1];
 if(!token)return json(401,{error:"Sign in to your verified SIFA account."},origin);
 const sb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await sb.auth.getUser(token);const user=auth?.user;
 if(authError||!user?.email||!user.email_confirmed_at)return json(401,{error:"Sign in with your verified SIFA email."},origin);
 // Private photo lookup is independent of admissions availability.
 if(new URL(req.url).searchParams.get("action")==="photo"){
  const {data:apps,error}=await sb.from("sifa_public_applications").select("id").eq("linked_user_id",user.id).neq("status","Withdrawn").order("submitted_at",{ascending:false}).limit(20);
  if(error)return json(503,{error:"Photo unavailable."},origin);
  for(const app of apps||[]){const {data:docs,error:docError}=await sb.from("sifa_application_documents").select("storage_path").eq("public_application_id",app.id).eq("storage_bucket","sifa-private-documents").like("storage_path",`public-applications/${app.id}/photo/%`).limit(1);if(docError)return json(503,{error:"Photo unavailable."},origin);if(!docs?.length)continue;
   const {data:signed,error:signError}=await sb.storage.from("sifa-private-documents").createSignedUrl(docs[0].storage_path,60);if(signError)return json(503,{error:"Photo unavailable."},origin);return json(200,{photo_url:signed.signedUrl},origin);}
  return json(200,{photo_url:null},origin);
 }
 if(Deno.env.get("SIFA_APPLICATIONS_OPEN")!=="true")return json(403,{error:"Applications are currently closed."},origin);
 if(Number(req.headers.get("content-length")||0)>9_000_000)return json(413,{error:"Your attachments exceed the permitted size."},origin);
 // Bound request body even if Content-Length is missing.
 const reader=req.body?.getReader();if(!reader)return json(400,{error:"Missing application."},origin);
 const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>9_000_000){await reader.cancel();return json(413,{error:"Your attachments exceed the permitted size."},origin);}chunks.push(value);}
 let form:FormData,body:Record<string,unknown>;
 try{form=await new Response(new Blob(chunks),{headers:{"content-type":req.headers.get("content-type")||""}}).formData();body=JSON.parse(String(form.get("application")||""));if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}catch{return json(400,{error:"Please submit a valid application form."},origin);}
 const fullName=cleanText(body.full_name,160),email=cleanText(body.email,254).toLowerCase(),phone=cleanText(body.phone,50),country=cleanText(body.country,100),program=cleanText(body.program,120);
 if(email!==user.email.trim().toLowerCase())return json(403,{error:"Use your verified account email."},origin);
 if(fullName.length<2||!validEmail(email)||phone.length<5||country.length<2||!program)return json(400,{error:"Please complete your personal information and program."},origin);
 const supplied=body.payload&&typeof body.payload==="object"&&!Array.isArray(body.payload)?body.payload as Record<string,unknown>:{};
 const payload:Record<string,string>={};for(const key of ["mode","cohort","schedule","background","softwareExperience","goals","financialSupport","scholarshipReason","financialCircumstances","scholarshipValue","nationality","city","education","status","language","kinyarwanda","occupationOther","finalReview"]){const v=cleanText(supplied[key],2000);if(v)payload[key]=v;}
 if(body.contact_consent!==true||body.accuracy_confirmed!==true||payload.finalReview!=="on")return json(400,{error:"Please confirm all final declarations."},origin);
 if(payload.mode!=="Live online"||!occupations.has(payload.status)||!['Yes','No'].includes(payload.kinyarwanda)||!payload.education||!payload.nationality||!payload.cohort||!payload.schedule||!payload.goals||(payload.status==='Other'&&!payload.occupationOther))return json(400,{error:"Please review your required application details."},origin);
 if(!['No financial assistance requested','Scholarship or fee-waiver request'].includes(payload.financialSupport)||(payload.financialSupport==='Scholarship or fee-waiver request'&&!payload.scholarshipReason))return json(400,{error:"Please complete your financial assistance selection."},origin);
 if(cleanText(body.website,200))return json(400,{error:"Invalid application."},origin);
 const {data:settings,error:settingsError}=await sb.from("admission_settings").select("applications_open,open_programs").eq("id",true).single();
 const allowedPrograms=(Deno.env.get("SIFA_OPEN_PROGRAMS")??"").split(",").map(v=>v.trim()).filter(Boolean);
 if(settingsError)return json(503,{error:"Admissions settings unavailable."},origin);
 if(!settings?.applications_open||!settings.open_programs?.includes(program)||!allowedPrograms.includes(program))return json(403,{error:"This program is not currently accepting applications."},origin);
 const prepared:{field:string;name:string;mime:string;bytes:Uint8Array}[]=[];let total=0;
 for(const [field,file] of form.entries()){
  if(field==='application')continue;
  if(!(file instanceof File)||![...required,...optional].includes(field))return json(400,{error:"Invalid attachment."},origin);
  const name=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-180),ext=name.split('.').pop()?.toLowerCase()||"";
  const allowed=field==='photo'?['jpg','jpeg','png']:field==='cv'?['pdf','doc','docx']:['pdf','jpg','jpeg','png'];
  total+=file.size;if(!file.size||file.size>5*1024*1024||total>8*1024*1024||prepared.length>=12)return json(413,{error:"Use up to 12 files, 5 MB each and 8 MB combined."},origin);
  if(!allowed.includes(ext))return json(400,{error:"Unsupported attachment format."},origin);
  const bytes=new Uint8Array(await file.arrayBuffer()),sig=Array.from(bytes.slice(0,8));
  const valid=ext==='pdf'?sig.slice(0,4).join(',')==='37,80,68,70':ext==='png'?sig.join(',')==='137,80,78,71,13,10,26,10':['jpg','jpeg'].includes(ext)?sig.slice(0,3).join(',')==='255,216,255':ext==='docx'?sig.slice(0,4).join(',')==='80,75,3,4':sig.join(',')==='208,207,17,224,161,177,26,225';
  if(!valid)return json(400,{error:"An attachment does not match its file format."},origin);
  prepared.push({field,name,mime:mimeTypes[ext],bytes});
 }
 if(required.some(field=>prepared.filter(f=>f.field===field).length!==1))return json(400,{error:"Upload one identification document, one qualification document and one passport photograph."},origin);
 const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"";
 const {data:rate,error:rateError}=await sb.rpc("sifa_allow_public_application",{p_email_hash:await sha256(email),p_ip_hash:ip?await sha256(ip):null});
 if(rateError)return json(503,{error:"Submission service unavailable."},origin);if(rate!==true)return json(429,{error:"Too many attempts. Please try again later."},origin);
 // Avoid unnecessary uploads if an existing record already owns this program.
 const [legacy,existing]=await Promise.all([sb.from("applications").select("id").eq("user_id",user.id).eq("payload->>course",program).not("status","in","(Withdrawn,Rejected)").limit(1),sb.from("sifa_public_applications").select("id").eq("linked_user_id",user.id).eq("program",program).not("status","in","(Withdrawn,Rejected)").limit(1)]);
 if(legacy.error||existing.error)return json(503,{error:"Unable to verify existing applications."},origin);
 if(legacy.data?.length||existing.data?.length)return json(409,{error:"An active application already exists. Open My Application to view it."},origin);
 const id=crypto.randomUUID(),ref=`SIFA-${new Date().getUTCFullYear()}-${id.replaceAll('-','').slice(0,10).toUpperCase()}`;
 const paths:string[]=[],docs:Record<string,unknown>[]=[];
 // Upload in small parallel batches, then create all database records atomically.
 for(let i=0;i<prepared.length;i+=3){const batch=prepared.slice(i,i+3);const results=await Promise.allSettled(batch.map(async f=>{const path=`public-applications/${id}/${f.field}/${crypto.randomUUID()}-${f.name}`;paths.push(path);const {error}=await sb.storage.from("sifa-private-documents").upload(path,f.bytes,{contentType:f.mime,upsert:false});if(error)throw error;docs.push({storage_path:path,original_filename:f.name,content_type:f.mime,byte_size:f.bytes.byteLength});payload['uploaded_'+f.field]='true';}));if(results.some(r=>r.status==='rejected')){await sb.storage.from("sifa-private-documents").remove(paths);return json(503,{error:"Documents could not be uploaded. Your application was not submitted."},origin);}}
 Object.assign(payload,{name:fullName,email,phone,country,course:program,documentStatus:"All core documents provided",contact_consent:"true",accuracy_confirmed:"true"});
 const {data:record,error:saveError}=await sb.rpc("sifa_finalize_application_v2",{p_id:id,p_ref:ref,p_user:user.id,p_name:fullName,p_email:email,p_phone:phone,p_country:country,p_program:program,p_payload:payload,p_docs:docs});
 if(saveError){
  // A lost response may hide a committed transaction: verify before removing documents.
  const {data:check,error:checkError}=await sb.from("sifa_public_applications").select("application_ref,submitted_at").eq("id",id).eq("linked_user_id",user.id).maybeSingle();
  if(check)return json(201,{ok:true,...check},origin);
  if(!checkError&&['23505','23503','23514','P0001','42501'].includes(saveError.code))await sb.storage.from("sifa-private-documents").remove(paths);
  if(saveError.code==='23505')return json(409,{error:"An active application already exists. Open My Application."},origin);
  console.error("Application finalization failed",saveError.code);return json(503,{error:"Submission could not be confirmed. Check My Application before trying again."},origin);
 }
 return json(201,{ok:true,application_ref:ref,submitted_at:record},origin);
 }catch(error){console.error("Application request failed",error instanceof Error?error.name:"unknown");return json(503,{error:"Submission could not be confirmed. Check My Application before trying again."},origin);}
});
