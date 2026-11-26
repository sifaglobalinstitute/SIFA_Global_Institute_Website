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
  if(action==="list-student"){if(b.program!==undefined && typeof b.program!=="string")return out(400,{error:"Invalid program request."},origin);const a=await access(db,user.id,(b.program||"").trim());if(!a){
   const {data:en,error:ee}=await db.from("sifa_enrollments").select("program,status,classroom_access_authorized,start_date,end_date,public_application_id,application_id").eq("student_user_id",user.id);if(ee)throw ee;
   const {data:apps,error:ae}=await db.from("sifa_public_applications").select("id,program,status").eq("linked_user_id",user.id);if(ae)throw ae;
   const {data:legacy,error:le}=await db.from("applications").select("id,status,payload").eq("user_id",user.id);if(le)throw le;
   const accepted=[...(apps||[]),...(legacy||[]).map(a=>({...a,program:a.payload?.course}))].filter(a=>a.status==="Accepted"&&(!b.program||a.program===b.program));
   const relevant=(en||[]).filter(e=>accepted.some(a=>a.program===e.program&&(a.id===e.public_application_id||a.id===e.application_id)));
   const reason=!accepted.length?"admission":!relevant.length?"enrollment":!relevant.some(e=>e.classroom_access_authorized)?"authorization":"eligibility";
   return out(403,{authorized:false,reason,error:"Your learning access is not active."},origin);}
   const {data:eligible,error:eligError}=await db.rpc("sifa_get_learning_eligibility",{p_student_user_id:user.id});if(eligError)throw eligError;
   const {data:resources,error:resourceError}=await db.from("sifa_classroom_resources").select("id,program,resource_type,title,description,resource_url,created_at").eq("program",a.program).eq("published",true).in("resource_type",["live","link"]).order("created_at",{ascending:false}).limit(100);if(resourceError)throw resourceError;
   const {data:rows,error}=await db.from("sifa_learning_materials").select("id,material_type,title,description,original_filename,storage_path,byte_size,created_at").eq("published",true).eq("program",a.program).order("sort_order").order("created_at",{ascending:false});if(error)throw error;
   const materials=[];for(const r of rows||[]){const {data:l,error:le}=await db.storage.from(bucket).createSignedUrl(r.storage_path,180);if(le)throw le;materials.push({id:r.id,type:r.material_type,title:r.title,description:r.description,filename:r.original_filename,bytes:r.byte_size,created_at:r.created_at,download_url:l.signedUrl})}
   return out(200,{authorized:true,program:a.program,access_basis:a.basis,programs:[...new Set((eligible||[]).map((e:any)=>e.program))],resources:resources||[],meeting_url:a.program==="QuickBooks Practical Training"?(Deno.env.get("SIFA_LIVE_CLASS_URL")||null):null,materials},origin)}
  const {data:role,error:re}=await db.from("sifa_staff_roles").select("role,active").eq("user_id",user.id).eq("active",true).maybeSingle();if(re||!role||!["administrator","coordinator","instructor"].includes(role.role))return out(403,{error:"Active SIFA administrator, coordinator, or instructor access is required."},origin);
  if(action==="list-programs"){const {data,error}=await db.from("sifa_programs").select("program_name").eq("is_active",true).order("display_order");if(error)throw error;return out(200,{programs:(data||[]).map(p=>p.program_name)},origin)}
  if(action==="list-resources"){const {data,error}=await db.from("sifa_classroom_resources").select("id,program,resource_type,title,description,published,created_at").order("created_at",{ascending:false}).limit(200);if(error)throw error;return out(200,{items:data||[]},origin)}
  if(action==="create-resource"){
   const title=s(b.title,180),program=s(b.program,180),type=s(b.resource_type,30),description=s(b.description,2000);let link:string|null=null;
   if(!["live","link","admission_notice"].includes(type)||title.length<2||!program||(type==="admission_notice"&&!description))return out(400,{error:"Provide a valid resource title, program and required details."},origin);
   if(type!=="admission_notice"){try{const u=new URL(s(b.resource_url,2000));if(u.protocol!=="https:"||u.username||u.password)throw Error();link=u.href;}catch{return out(400,{error:"Enter a valid HTTPS link."},origin)}}
   const {data:course,error:ce}=await db.from("sifa_programs").select("program_name").eq("program_name",program).eq("is_active",true).maybeSingle();if(ce)throw ce;if(!course)return out(400,{error:"Select an active SIFA program."},origin);
   const {data,error}=await db.from("sifa_classroom_resources").insert({title,program,resource_type:type,description,resource_url:link,published:b.published===true,created_by:user.id}).select("id,title").single();if(error)throw error;return out(201,{item:data},origin)
  }
  if(action==="set-resource-published"){const {data,error}=await db.from("sifa_classroom_resources").update({published:b.published===true}).eq("id",s(b.id,80)).select("id,published").single();if(error)throw error;return out(200,{item:data},origin)}
  if(action==="delete-resource"){const {data,error}=await db.from("sifa_classroom_resources").delete().eq("id",s(b.id,80)).select("id").single();if(error)throw error;return out(200,{item:data},origin)}
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
