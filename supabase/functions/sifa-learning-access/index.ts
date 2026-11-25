// Protected live-class access decision. The meeting URL is returned only after server-side checks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")??"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const origins=(Deno.env.get("SIFA_ALLOWED_ORIGINS")??"").split(",").map(s=>s.trim()).filter(Boolean);
const base={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
function out(status:number,body:Record<string,unknown>,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{...base,...(origin&&origins.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}:{})}})}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");if(req.method==="OPTIONS")return origin&&origins.includes(origin)?new Response(null,{status:204,headers:{...base,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}}):new Response(null,{status:403,headers:base});
 if(req.method!=="POST")return out(405,{error:"Method not allowed."},origin);if(!origin||!origins.includes(origin))return out(403,{error:"Origin not allowed."},origin);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return out(401,{error:"Sign in to check your learning access."},origin);if(!url||!key)return out(503,{error:"Learning access is not configured."},origin);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const {data:u,error:ue}=await db.auth.getUser(token);if(ue||!u.user)return out(401,{error:"Your session has expired."},origin);
 let requestedProgram = "";
 try {
   const raw = await req.text();
   if (raw.trim()) {
     const body = JSON.parse(raw);
     if (!body || typeof body !== "object" || Array.isArray(body) ||
         (body.program !== undefined && typeof body.program !== "string")) {
       return out(400,{error:"Invalid program request."},origin);
     }
     requestedProgram = (body.program || "").trim();
   }
 } catch { return out(400,{error:"Invalid request."},origin); }
 const {data:eligible,error}=await db.rpc("sifa_get_learning_eligibility",{p_student_user_id:u.user.id});
 if(error)return out(500,{error:"Could not verify your learning access. Contact SIFA support."},origin);
 // The legacy global meeting link is reserved for the first launch program.
 const program = requestedProgram || "QuickBooks Practical Training";
 const match = (eligible || []).find((e:{program:string})=>e.program===program);
 if(match){
   const meet=program==="QuickBooks Practical Training" ? (Deno.env.get("SIFA_LIVE_CLASS_URL")??"") : "";
   if(!meet)return out(503,{error:"Learning access is approved, but the class link is not configured. Contact SIFA support."},origin);
   return out(200,{authorized:true,program:match.program,access_basis:match.access_basis,meeting_url:meet,message:"Do not share the private class link. The instructor may verify attendance."},origin);
 }

 return out(403,{authorized:false,message:"Your learning access is not currently active. Submit a payment receipt or contact SIFA if you have an approved scholarship or fee waiver."},origin);
});
