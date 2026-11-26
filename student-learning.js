(async()=>{
 const cfg=window.SIFA_SUPABASE_CONFIG||{};
 const status=document.getElementById("learningStatus"), details=document.getElementById("learningDetails"), overview=document.getElementById("classroomOverview");
 if(!status||!details||!overview)return;
 function hideClassroom(){overview.hidden=true;details.hidden=true;details.replaceChildren();}
 function show(msg,type=""){status.textContent=msg;status.className="classroom-status"+(type?" "+type:"");}
 function notice(kind,reason){
  hideClassroom();
  const messages={
   restricted:["Classroom access restricted","Your classroom is not currently available. Your enrollment or current payment eligibility must be confirmed before you can enter.","If you are not enrolled, explore the available programs and admission information. If you have an enrollment, check its status and any outstanding invoices in your Student Portal. Do not make another payment unless your payment record shows it is required.","View Student Dashboard","student-portal.html"],
   signin:["Sign in to your Student Portal","Please sign in to check your classroom eligibility.","Use your registered student account, then return to your classroom.","Sign in","student-portal.html?next=student-learning.html"],
   unavailable:["Classroom temporarily unavailable","We could not verify your classroom eligibility right now. This does not mean your payment was rejected or your enrollment suspended.","Refresh the page to try again. If the problem continues, contact SIFA support.","Return to Student Portal","student-portal.html"]
  };
  let [title,intro,steps,action,href]=messages[kind];
  if(kind==='restricted'){const explanations={admission:'An accepted application is required before classroom access can be granted.',enrollment:'Your admission must be linked to a valid enrollment before classroom access can be granted.',authorization:'Classroom authorization has not yet been granted by SIFA administration.',eligibility:'Your enrollment dates, active status, and current tuition clearance or temporary grace period must all be valid.'};intro=explanations[reason]||intro;steps='Check your admission, enrollment and payment records. Contact SIFA if you need assistance. Do not pay again unless your invoice requires payment.';}
  status.className="classroom-status restricted";
  status.innerHTML=`<div class="sifa-access-header"><div class="sifa-access-kicker">SIFA Global Institute · Student access</div><h2></h2><p></p></div><div class="sifa-access-body"><div><h3>What to do next</h3><p class="sifa-next-step"></p><div class="sifa-access-actions"><a class="sifa-action primary" href="#"></a><a class="sifa-action secondary" href="contact.html">Contact SIFA support</a></div></div><div><h3>Need assistance?</h3><p>Email: <a href="mailto:sifaglobalinstitute12@gmail.com">sifaglobalinstitute12@gmail.com</a></p><p>Türkiye: <a href="tel:+905372746944">+90 537 274 6944</a><br>Rwanda: <a href="tel:+250782817643">+250 782 817 643</a></p><a href="student-portal.html">Return to Student Portal</a></div></div>`;
  status.querySelector("h2").textContent=title;
  status.querySelector(".sifa-access-header p").textContent=intro;
  status.querySelector(".sifa-next-step").textContent=steps;
  const a=status.querySelector(".sifa-action.primary");a.href=href;a.textContent=action;
 }
 hideClassroom();
 try{
  if(!window.supabase||!cfg.url||!cfg.anonKey){notice("unavailable");return;}
  const sb=window.supabase.createClient(cfg.url,cfg.anonKey,window.SIFA_AUTH_OPTIONS);
  const {data,error}=await sb.auth.getSession();
  if(error){notice("unavailable");return;}
  if(!data.session){notice("signin");return;}
  void window.SIFALoadPhoto?.(sb,cfg,data.session.user.id);
  const r=await fetch(`${cfg.url}/functions/v1/sifa-classroom-api`,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":`Bearer ${data.session.access_token}`},body:JSON.stringify({action:"list-student",program:new URLSearchParams(location.search).get("program")||""})});
  const b=await r.json().catch(()=>({}));
  if(r.status===401){notice("signin");return;}
  if(r.status===403&&b.authorized===false){notice("restricted",b.reason);return;}
  if(!r.ok||b.authorized!==true){notice("unavailable");return;}
  show(`Access approved for ${b.program}. Your protected classroom is ready.`,"success");
  details.replaceChildren();
  const hero=document.createElement("div");hero.className="classroom-welcome";hero.innerHTML="<span class='classroom-kicker'>YOUR SIFA CLASSROOM</span><h2></h2><p>Keep your learning materials organized here. Downloads are private and temporary.</p>";hero.querySelector("h2").textContent=b.program;details.append(hero);
  if((b.programs||[]).length>1){const label=document.createElement('label');label.textContent='Choose your classroom ';const select=document.createElement('select');for(const name of b.programs)select.add(new Option(name,name,false,name===b.program));select.addEventListener('change',()=>{location.href='student-learning.html?program='+encodeURIComponent(select.value)});label.append(select);details.append(label);}
  for(const item of b.resources||[]){const section=document.createElement('section');section.className='classroom-panel';const h=document.createElement('h3');h.textContent=item.title;const desc=document.createElement('p');desc.textContent=item.description||'';section.append(h,desc);try{const u=new URL(item.resource_url);if(u.protocol==='https:'&&!u.username&&!u.password){const a=document.createElement('a');a.className='private-link';a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.resource_type==='live'?'Join live class':'Open learning resource';section.append(a)}}catch{}details.append(section);}
  const meet=document.createElement("section");meet.className="classroom-panel";meet.innerHTML="<h3>Live classroom meeting</h3><p>Use this private link only for your enrolled class.</p>";
  if(b.meeting_url){const a=document.createElement("a");a.className="private-link";a.href=b.meeting_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Join live class";meet.append(a)}else{const p=document.createElement("p");p.className="small";p.textContent="The class link has not been configured yet. Please contact SIFA support.";meet.append(p)}if(!(b.resources||[]).some(x=>x.resource_type==='live'))details.append(meet);
  const categories=[["book","Books and PDF materials"],["lesson","Lessons and notes"],["assignment","Assignments"],["announcement","Announcements"]];
  for(const [type,label] of categories){const section=document.createElement("section");section.className="classroom-panel";const h=document.createElement("h3");h.textContent=label;section.append(h);const items=(b.materials||[]).filter(x=>type==="book" ? (!x.type||x.type==="book") : x.type===type);
   if(!items.length){const p=document.createElement("p");p.className="empty-state";p.textContent="No materials published here yet.";section.append(p)}
   for(const item of items){const card=document.createElement("article");card.className="material-item";const title=document.createElement("h4");title.textContent=item.title||"Learning material";card.append(title);if(item.description){const p=document.createElement("p");p.textContent=item.description;card.append(p)}const meta=document.createElement("p");meta.className="small";meta.textContent=`PDF · ${Math.max(1,Math.round((Number(item.bytes)||0)/1024))} KB`;card.append(meta);if(item.download_url){const a=document.createElement("a");a.className="private-link";a.href=item.download_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Open / download PDF";card.append(a)}section.append(card)}
   details.append(section)
  }
  details.hidden=false;overview.hidden=false;
 }catch(e){console.error("SIFA classroom loading error:",e);notice("unavailable");}
})();
