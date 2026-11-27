(()=>{
 const cfg=window.SIFA_SUPABASE_CONFIG||{},$=id=>document.getElementById(id),msg=(t,type="")=>{$("cmMessage").textContent=t;$("cmMessage").className="cm-msg"+(type?" "+type:"")};
 if(!window.supabase||!cfg.url||!cfg.anonKey){msg("Supabase is not configured.","error");return}
 
const sb = window.supabase.createClient(
  cfg.url,
  cfg.anonKey,
  window.SIFA_AUTH_OPTIONS
);

 async function api(action,payload={}){const {data}=await sb.auth.getSession(),token=data.session?.access_token;if(!token)throw Error("Please sign in again.");const r=await fetch(`${cfg.url}/functions/v1/sifa-classroom-api`,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":`Bearer ${token}`},body:JSON.stringify({action,...payload})});const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||"Classroom request failed.");return b}
 function btn(label,fn,primary=false){const b=document.createElement("button");b.type="button";b.className=primary?"btn btn-primary":"btn btn-secondary";b.textContent=label;b.addEventListener("click",fn);return b}
 const form=$('cmUploadForm');
 function syncType(){const type=form.elements.material_type.value;const link=['live','link'].includes(type),notice=type==='admission_notice';$('cmFileField').hidden=link||notice;form.elements.file.required=!link&&!notice;$('cmUrlField').hidden=!link;form.elements.resource_url.required=link;form.elements.description.required=notice;}
 form.elements.material_type.addEventListener('change',syncType);syncType();
 async function loadPrograms(){const b=await api('list-programs');const select=form.elements.program,old=select.value;select.replaceChildren(new Option('Select program',''));for(const name of b.programs||[])select.add(new Option(name,name));if([...select.options].some(o=>o.value===old))select.value=old;}
 async function renderResources(){const b=await api('list-resources');const host=$('cmMaterials');if(!b.items?.length)return;const heading=document.createElement('h3');heading.textContent='Meeting links, external links and admission notices';host.append(heading);for(const item of b.items){const card=document.createElement('article');card.className='cm-item';const title=document.createElement('h3');title.textContent=item.title;const info=document.createElement('p');info.textContent=`${item.program} · ${item.resource_type.replaceAll('_',' ')} · ${item.published?'Published':'Draft'}`;const desc=document.createElement('p');desc.textContent=item.description||'';card.append(title,info,desc,btn(item.published?'Unpublish':'Publish',async()=>{try{await api('set-resource-published',{id:item.id,published:!item.published});await load();msg('Resource updated.','success')}catch(e){msg(e.message,'error')}}),btn('Delete resource',async()=>{if(!confirm('Delete this resource?'))return;try{await api('delete-resource',{id:item.id});await load();msg('Resource deleted.','success')}catch(e){msg(e.message,'error')}}));host.append(card);}}
 const typeLabel={book:"Books and PDF materials",lesson:"Lessons and notes",assignment:"Assignments",announcement:"Announcements"};
 async function load(){try{const b=await api('list-staff');renderList(b.items);await renderResources();}catch(e){msg(e.message,'error');$('cmMaterials').textContent='Resources could not be loaded.';}}
 $("cmLoginForm").addEventListener("submit",async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);try{msg("Signing in…");const {error}=await sb.auth.signInWithPassword({email:String(f.get("email")).trim(),password:String(f.get("password"))});if(error)throw error;await update()}catch(e){msg(e.message||"Sign in failed.","error")}});
 async function update(){const {data}=await sb.auth.getSession();if(!data.session){$("cmLogin").hidden=false;$("cmWorkspace").hidden=true;return}try{const b=await api("list-staff");const user=data.session.user;const name=String(user.user_metadata?.full_name||user.user_metadata?.name||"").trim();$("cmIdentity").textContent=name||"Staff member — name not set";$("cmStaffEmail").textContent=user.email||"";$("cmStaffRole").textContent=String(b.role||"Staff").replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());$("cmStaffAvatar").textContent=name?name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase():"S";$("cmLogin").hidden=true;$("cmWorkspace").hidden=false;msg(`Staff access verified. Role: ${b.role}.`,"success");await loadPrograms();renderList(b.items);await renderResources()}catch(e){$("cmLogin").hidden=false;$("cmWorkspace").hidden=true;msg(e.message,"error")}}
 function renderList(items){const host=$("cmMaterials");host.replaceChildren();if(!items?.length){host.textContent="No PDF materials yet. Create a resource using the form above.";return}for(const item of items){const card=document.createElement("article");card.className="cm-item";const h=document.createElement("h3");h.textContent=item.title;card.append(h);const p=document.createElement("p");p.textContent=`${item.program} · ${typeLabel[item.material_type]||item.material_type} · ${Math.max(1,Math.round(item.byte_size/1024))} KB`;card.append(p);if(item.description){const d=document.createElement("p");d.textContent=item.description;card.append(d)}const status=document.createElement("p");status.className="cm-small";status.textContent=item.published?"Published to eligible students":"Draft — not visible to students";card.append(status);const actions=document.createElement("div");actions.className="cm-actions";actions.append(btn(item.published?"Unpublish":"Publish",async()=>{try{await api("set-published",{id:item.id,published:!item.published});msg(item.published?"Material unpublished.":"Material published.","success");await load()}catch(e){msg(e.message,"error")}},true));actions.append(btn("Delete permanently",async()=>{if(!confirm(`Permanently delete “${item.title}” and its PDF?`))return;try{await api("delete",{id:item.id});msg("Material and file deleted.","success");await load()}catch(e){msg(e.message,"error")}}));card.append(actions);host.append(card)}}
 $("cmUploadForm").addEventListener("submit",async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),file=f.get("file");const type=String(f.get('material_type'));if(['live','link','admission_notice'].includes(type)){const button=$('cmUploadButton');button.disabled=true;try{await api('create-resource',{title:String(f.get('title')),program:String(f.get('program')),resource_type:type,resource_url:String(f.get('resource_url')||''),description:String(f.get('description')||''),published:f.get('published')==='on'});msg('Resource saved successfully.','success');form.reset();syncType();await load();}catch(e){msg(e.message,'error')}finally{button.disabled=false;}return;}if(!(file instanceof File)||!file.size){msg("Choose a PDF file first.","error");return}if(file.size>20*1024*1024){msg("This PDF is larger than 20 MB. Compress it and try again.","error");return}if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){msg("Only PDF files are allowed.","error");return}
 const button=$("cmUploadButton");button.disabled=true;button.textContent="Uploading…";
 try{const meta={title:String(f.get("title")).trim(),program:String(f.get("program")).trim(),material_type:String(f.get("material_type")),filename:file.name,byte_size:file.size,content_type:"application/pdf",description:String(f.get("description")||"").trim()};
 const upload=await api("create-upload",meta);const {data:sessionData}=await sb.auth.getSession();const {error:upError}=await sb.storage.from("sifa-learning-materials").uploadToSignedUrl(upload.path,upload.token,file,{contentType:"application/pdf",upsert:false});if(upError)throw upError;
 await api("publish",{...meta,path:upload.path,published:f.get("published")==="on",sort_order:0});msg("PDF uploaded successfully. "+(f.get("published")==="on"?"It is published for eligible students.":"It is saved as a draft until you publish it."),"success");
$("cmUploadForm").reset();

syncType();
await load();
 }catch(e){msg(e.message||"Upload failed. Check that the classroom schema and Edge Function are deployed.","error")}finally{button.disabled=false;button.textContent="Save resource"}});
 
$("cmRefresh").addEventListener("click", async () => {
  msg("Refreshing classroom materials…");

  try {
    const result = await api("list-staff");
    renderList(result.items || []);await renderResources();
    msg(
      `Loaded ${(result.items || []).length} classroom materials.`,
      "success"
    );
  } catch (error) {
    msg(error.message || "Failed to refresh materials.", "error");
  }
});
$("cmSignOut").addEventListener("click",async()=>{await sb.auth.signOut();await update();msg("Signed out.","success")});sb.auth.onAuthStateChange(()=>setTimeout(update,0));update();
})();