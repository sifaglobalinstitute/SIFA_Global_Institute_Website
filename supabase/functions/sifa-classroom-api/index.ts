import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")??"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const origins=(Deno.env.get("SIFA_ALLOWED_ORIGINS")??"").split(",").map(x=>x.trim()).filter(Boolean), bucket="sifa-learning-materials", max=20*1024*1024;
const base={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
const s=(v:unknown,n=500)=>typeof v==="string"?v.trim().slice(0,n):"";
function out(status:number,body:Record<string,unknown>,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{...base,...(origin&&origins.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}:{})}})}
async function access(db:any,uid:string,requestedProgram:string){
 const {data,error}=await db.rpc("sifa_get_learning_eligibility",{p_student_user_id:uid});
 if(error)throw error;
 const eligible=(data||[]) as {program:string;access_basis:string;enrollment_id:string}[];
 eligible.sort((a,b)=>a.program.localeCompare(b.program)||a.enrollment_id.localeCompare(b.enrollment_id));
 const e=requestedProgram?eligible.find(row=>row.program===requestedProgram):eligible[0];
 return e?{program:e.program,basis:e.access_basis}:null;
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");if(req.method==="OPTIONS")return origin&&origins.includes(origin)?new Response(null,{status:204,headers:{...base,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"}}):new Response(null,{status:403,headers:base});
 if(req.method!=="POST")return out(405,{error:"Method not allowed"},origin);if(!origin||!origins.includes(origin))return out(403,{error:"Origin not allowed"},origin);if(!url||!key)return out(503,{error:"Classroom service not configured"},origin);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return out(401,{error:"Please sign in first"},origin);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),{data:ud,error:ue}=await db.auth.getUser(token),user=ud?.user;if(ue||!user)return out(401,{error:"Session expired. Sign in again."},origin);
 let b:any={};try{b=await req.json()}catch{return out(400,{error:"Invalid request"},origin)}if(!b||typeof b!=="object"||Array.isArray(b))return out(400,{error:"Invalid request"},origin);const action=s(b.action,60);
 try{
  if(action==="list-student"){if(b.program!==undefined && typeof b.program!=="string")return out(400,{error:"Invalid program request."},origin);const a=await access(db,user.id,(b.program||"").trim());if(!a)return out(403,{authorized:false,error:"Your learning access is not active. Contact SIFA support if you believe this is incorrect."},origin);
   const {data:rows,error}=await db.from("sifa_learning_materials").select("id,material_type,title,description,original_filename,storage_path,byte_size,created_at").eq("published",true).eq("program",a.program).order("sort_order").order("created_at",{ascending:false});if(error)throw error;
   const materials=[];for(const r of rows||[]){const {data:l,error:le}=await db.storage.from(bucket).createSignedUrl(r.storage_path,180);if(le)throw le;materials.push({id:r.id,type:r.material_type,title:r.title,description:r.description,filename:r.original_filename,bytes:r.byte_size,created_at:r.created_at,download_url:l.signedUrl})}
   return out(200,{authorized:true,program:a.program,access_basis:a.basis,meeting_url:a.program==="QuickBooks Practical Training"?(Deno.env.get("SIFA_LIVE_CLASS_URL")||null):null,materials},origin)}
  const {data:role,error:re}=await db.from("sifa_staff_roles").select("role,active").eq("user_id",user.id).eq("active",true).maybeSingle();if(re||!role||!["administrator","coordinator","instructor"].includes(role.role))return out(403,{error:"Active SIFA administrator, coordinator, or instructor access is required."},origin);
  if(action==="list-staff"){const {data,error}=await db.from("sifa_learning_materials").select("id,program,material_type,title,description,original_filename,storage_path,byte_size,published,sort_order,created_at").order("created_at",{ascending:false}).limit(300);if(error)throw error;return out(200,{items:data||[],role:role.role},origin)}
  if(action==="create-upload"){const title=s(b.title,180),program=s(b.program,180),filename=s(b.filename,180),type=s(b.material_type,30),size=Number(b.byte_size);if(!["book","lesson","assignment","announcement"].includes(type)||title.length<2||!program||!filename||!Number.isFinite(size)||size<1||size>max||b.content_type!=="application/pdf")return out(400,{error:"Enter a title and course, and select a PDF no larger than 20 MB."},origin);
   const safe=filename.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"material.pdf",path=`${crypto.randomUUID()}/${safe}`;const {data,error}=await db.storage.from(bucket).createSignedUploadUrl(path,{upsert:false});if(error)throw error;return out(200,{path,token:data.token,metadata:{title,program,material_type:type,description:s(b.description,2000),filename:safe,size}},origin)}
  if(action==="publish"){const path=s(b.path,300),title=s(b.title,180),program=s(b.program,180),filename=s(b.filename,180),type=s(b.material_type,30),size=Number(b.byte_size);if(!["book","lesson","assignment","announcement"].includes(type)||!path||!title||!program||!filename||!Number.isFinite(size)||size<1||size>max||b.content_type!=="application/pdf")return out(400,{error:"Material metadata is invalid."},origin);
   const bits=path.split("/"),{data:files,error:fe}=await db.storage.from(bucket).list(bits[0],{limit:100});if(fe)throw fe;if(!(files||[]).some((f:any)=>f.name===bits.slice(1).join("/")))return out(400,{error:"Uploaded PDF could not be verified."},origin);
   const {data,error}=await db.from("sifa_learning_materials").insert({program,material_type:type,title,description:s(b.description,2000),original_filename:filename,storage_path:path,content_type:"application/pdf",byte_size:size,published:b.published===true,sort_order:Number(b.sort_order)||0,created_by:user.id}).select("id,title,program,published").single();if(error)throw error;return out(201,{item:data},origin)}
  if(action==="set-published"){const {data,error}=await db.from("sifa_learning_materials").update({published:b.published===true,updated_at:new Date().toISOString()}).eq("id",s(b.id,80)).select("id,published").single();if(error)throw error;return out(200,{item:data},origin)}
  if(action==="delete"){const {data:item,error:re}=await db.from("sifa_learning_materials").select("id,storage_path").eq("id",s(b.id,80)).single();if(re)throw re;const {error:se}=await db.storage.from(bucket).remove([item.storage_path]);if(se)throw se;const {error}=await db.from("sifa_learning_materials").delete().eq("id",item.id);if(error)throw error;return out(200,{ok:true},origin)}
  return out(400,{error:"Unknown classroom action"},origin)
 }catch(e){console.error("sifa-classroom-api",e);return out(500,{error:"Classroom request failed. Check the Supabase function logs."},origin)}
});
