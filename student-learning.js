(async()=>{
 const cfg=window.SIFA_SUPABASE_CONFIG||{},status=document.getElementById("learningStatus"),details=document.getElementById("learningDetails");
 const show=(msg,type="")=>{if(!status)return;status.textContent=msg;status.className="classroom-status"+(type?" "+type:"")};
 if(!status||!details)return;
 if(!window.supabase||!cfg.url||!cfg.anonKey){show("Learning access service is not configured. Contact SIFA support.","error");return}
 
const sb = window.supabase.createClient(
  cfg.url,
  cfg.anonKey,
  window.SIFA_AUTH_OPTIONS
);

 try{
  const {data,error}=await sb.auth.getSession();
  if(error||!data.session){
   show("Please sign in to your Student Portal to check access.","error");
   const a=document.createElement("a");a.className="private-link";a.href="student-portal.html?next=student-learning.html";a.textContent="Open Student Portal";status.append(" ",a);return
  }
  const r=await fetch(`${cfg.url}/functions/v1/sifa-classroom-api`,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":`Bearer ${data.session.access_token}`},body:JSON.stringify({action:"list-student"})});
  const b=await r.json().catch(()=>({}));
  if(r.status===404||r.status===503){show("SIFA classroom service is not deployed or configured yet. Your payment status has not been determined. Please try again later or contact SIFA support.","error");return}
  
if (!r.ok || !b.authorized) {
  details.hidden = true;

  if (r.status === 403 && b.authorized === false) {
    show(
      "Your student account has been recognized. Access to private classes and learning materials is currently pending. SIFA Global Institute will enable classroom access once your enrollment and applicable payment requirements have been verified.",
      "access-pending"
    );
  } else {
    show(
      b.error || "We could not verify your classroom access right now. Please try again or contact SIFA Support.",
      "error"
    );
  }

  return;
}

  show(`Access approved for ${b.program}. Your protected classroom is ready.`,"success");
  details.replaceChildren();
  const hero=document.createElement("div");hero.className="classroom-welcome";hero.innerHTML="<span class='classroom-kicker'>YOUR SIFA CLASSROOM</span><h2></h2><p>Keep your learning materials organized here. Downloads are private and temporary.</p>";hero.querySelector("h2").textContent=b.program;details.append(hero);
  const meet=document.createElement("section");meet.className="classroom-panel";meet.innerHTML="<h3>Live Google Meet class</h3><p>Use this private link only for your enrolled class.</p>";
  if(b.meeting_url){const a=document.createElement("a");a.className="private-link";a.href=b.meeting_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Join live class";meet.append(a)}else{const p=document.createElement("p");p.className="small";p.textContent="The class link has not been configured yet. Please contact SIFA support.";meet.append(p)}details.append(meet);
  const categories=[["book","Books and PDF materials"],["lesson","Lessons and notes"],["assignment","Assignments"],["announcement","Announcements"]];
  for(const [type,label] of categories){const section=document.createElement("section");section.className="classroom-panel";const h=document.createElement("h3");h.textContent=label;section.append(h);const items=(b.materials||[]).filter(x=>type==="book" ? (!x.type||x.type==="book") : x.type===type);
   if(!items.length){const p=document.createElement("p");p.className="empty-state";p.textContent="No materials published here yet.";section.append(p)}
   for(const item of items){const card=document.createElement("article");card.className="material-item";const title=document.createElement("h4");title.textContent=item.title||"Learning material";card.append(title);if(item.description){const p=document.createElement("p");p.textContent=item.description;card.append(p)}const meta=document.createElement("p");meta.className="small";meta.textContent=`PDF · ${Math.max(1,Math.round((Number(item.bytes)||0)/1024))} KB`;card.append(meta);if(item.download_url){const a=document.createElement("a");a.className="private-link";a.href=item.download_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Open / download PDF";card.append(a)}section.append(card)}
   details.append(section)
  }
  const note=document.createElement("p");note.className="small";note.textContent="Do not forward class links or downloaded materials without permission. SIFA may verify enrollment and attendance.";details.append(note);details.hidden=false;
 }catch(e){
  console.error("SIFA classroom loading error:",e);
  details.hidden=true;
  show("We could not load your classroom right now. Your access status has not changed. Please refresh the page or contact SIFA support.","error");
 }
})();