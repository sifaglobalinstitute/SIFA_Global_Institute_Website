(() => {
 const cfg=window.SIFA_SUPABASE_CONFIG||{};const $=id=>document.getElementById(id);const msg=(text,type='')=>{const el=$('adminMessage');el.textContent=text;el.className='admin-message'+(type?' '+type:'');el.setAttribute('role',type==='error'?'alert':'status');if(type==='error')el.scrollIntoView({block:'center',behavior:'smooth'});};
 if(!window.supabase||!cfg.url||!cfg.anonKey){msg('Supabase client is not configured.','error');return;}
 
const sb = window.supabase.createClient(
  cfg.url,
  cfg.anonKey,
  window.SIFA_AUTH_OPTIONS
);
let session = null;
let currentRole = "";

 async function api(action,payload={}){const {data}=await sb.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error('Please sign in again.');const r=await fetch(`${cfg.url}/functions/v1/sifa-admin-api`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.anonKey,'Authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'The request failed.');return b;}
 function button(label,handler,cls='btn btn-secondary'){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.addEventListener('click',handler);return b;}

 // Shared, accessible institutional workflow dialog. No HTML interpolation.
 function workflowDialog(title, description, context, fields=[], tone='#166534', action='Confirm', acknowledgement='') {
   return new Promise(resolve => {
     const d=document.createElement('dialog');
     Object.assign(d.style,{position:'fixed',inset:'0',margin:'auto',width:'min(540px, calc(100vw - 32px))',maxHeight:'85vh',overflow:'auto',boxSizing:'border-box',border:'1px solid #d6e2ed',borderRadius:'16px',padding:'24px',background:'#fff',color:'#102c49',boxShadow:'0 20px 70px #0005'});
     const form=document.createElement('form');
     const add=(tag,text,parent=form)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
     add('p','SIFA GLOBAL INSTITUTE · STAFF ADMINISTRATION').className='small-muted';
     const heading=add('h2',title);heading.id='sifa-workflow-title';d.setAttribute('aria-labelledby',heading.id);
     add('p',description);if(context)add('p',context).style.cssText='background:#f1f5f9;padding:12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere';
     const inputs={};
     for(const f of fields){const label=add('label',f.label);label.style.cssText='display:block;margin:12px 0;font-weight:600';const input=document.createElement(f.type==='textarea'?'textarea':'input');if(f.type!=='textarea')input.type=f.type||'text';input.required=true;if(f.minLength)input.minLength=f.minLength;if(f.value)input.value=f.value;input.style.cssText='display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #cbd5e1;border-radius:8px';label.append(input);inputs[f.key]=input;}
     if(acknowledgement){const label=add('label','');const check=document.createElement('input');check.type='checkbox';check.required=true;label.append(check,document.createTextNode(' '+acknowledgement));label.style.display='block';}
     const controls=add('div','');controls.style.cssText='display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:20px';
     controls.append(button('Cancel',()=>d.close('cancel')));const ok=add('button',action,controls);ok.type='submit';ok.className='btn';ok.style.cssText=`background:${tone};color:white;border:1px solid ${tone};font-weight:700`;
     let result=null;form.addEventListener('submit',e=>{e.preventDefault();const values={};for(const f of fields){const v=inputs[f.key].value.trim();if(!v||v.length<(f.minLength||1)){inputs[f.key].setCustomValidity('Please enter a valid value.');inputs[f.key].reportValidity();inputs[f.key].setCustomValidity('');return;}if(f.type==='datetime-local'&&(!Number.isFinite(new Date(v).getTime())||new Date(v).getTime()<=Date.now())){inputs[f.key].setCustomValidity('Choose a future expiry date and time.');inputs[f.key].reportValidity();inputs[f.key].setCustomValidity('');return;}values[f.key]=f.type==='datetime-local'?new Date(v).toISOString():v;}result=values;d.close('confirm');});
     d.append(form);d.addEventListener('close',()=>{d.remove();resolve(d.returnValue==='confirm'?result:null);},{once:true});document.body.append(d);try{d.showModal();}catch{d.remove();resolve(null);}
   });
 }

 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const pretty=k=>({status:'Occupation / status',mode:'Learning mode',kinyarwanda:'Speaks Kinyarwanda',financialSupport:'Financial support requested',application_ref:'Application reference',monthly_discount_percent:'Monthly discount (%)',uploaded_photo:'Photograph uploaded',uploaded_identityDocument:'Identification uploaded',uploaded_educationCertificate:'Qualification uploaded'}[k]||k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()));
 function fields(obj){const grid=el('div',undefined,'staff-fields');for(const [k,v] of Object.entries(obj||{})){if(v===null||v===undefined||v==='')continue;const f=el('div',undefined,'staff-field');f.append(el('small',pretty(k)));if(typeof v==='object'&&!Array.isArray(v))f.append(fields(v));else f.append(el('span',Array.isArray(v)?v.map(x=>typeof x==='object'?JSON.stringify(x):x).join(', '):String(v)));grid.append(f);}return grid;}
 function record(card,status,search){card.dataset.status=String(status||'').toLowerCase().replaceAll(' ','_');card.dataset.search=String(search||'').toLowerCase();return card;}
 function fold(title,child){const d=el('details',undefined,'staff-record');d.append(el('summary',title),child);return d;}
 const sectionMap={applications:'refreshApps',scholarships:'refreshScholarships',enrollments:'refreshEnrollments',certificates:'refreshCertificates',receipts:'refreshReceipts'};
 let activeSection='applications';let loadedCounts={};
 function filterRecords(){const q=$('staffSearch').value.trim().toLowerCase(),status=$('staffStatus').value;const panel=$('admin-'+activeSection);if(!panel)return;for(const c of panel.querySelectorAll('[data-search]'))c.hidden=!(c.dataset.search.includes(q)&&(!status||c.dataset.status===status));}
 function sectionOptions(){const panel=$('admin-'+activeSection),select=$('staffStatus'),prev=select.value;select.replaceChildren(new Option('All statuses',''));for(const x of new Set([...panel.querySelectorAll('[data-status]')].map(n=>n.dataset.status).filter(Boolean)))select.add(new Option(pretty(x),x));select.value=[...select.options].some(o=>o.value===prev)?prev:'';filterRecords();}
 function selectSection(id){const target=$('admin-'+id);if(!target||target.classList.contains('hidden'))return;activeSection=id;for(const a of document.querySelectorAll('.sifa-shortcuts a')){const panel=$(a.hash.slice(1));if(panel)panel.style.display=panel===target?'':'none';a.setAttribute('aria-current',String(panel===target));}$('staffSearch').value='';$('staffStatus').value='';$('staffRefresh').disabled=!sectionMap[id];$('staffSearch').disabled=!sectionMap[id];$('staffStatus').disabled=!sectionMap[id];sectionOptions();}
 function count(id,n){loadedCounts[id]=n;const host=$('staffKpis');host.replaceChildren();for(const [key,value] of Object.entries(loadedCounts)){const card=el('div',undefined,'staff-kpi');card.append(el('strong',value),el('small',pretty(key)+' · loaded'));host.append(card);}if(activeSection===id)sectionOptions();}
 document.querySelectorAll('.sifa-shortcuts a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();selectSection(a.hash.slice(7));}));$('staffSearch').addEventListener('input',filterRecords);$('staffStatus').addEventListener('change',filterRecords);$('staffRefresh').addEventListener('click', async () => {
    const button = $('staffRefresh');
    const loaders = {
        applications: loadApps,
        scholarships: loadScholarships,
        enrollments: loadEnrollments,
        certificates: loadCertificates,
        receipts: loadReceipts
    };

    const loader = loaders[activeSection];
    if (!loader || button.disabled) return;

    button.disabled = true;
    button.textContent = 'Refreshing records...';

    try {
        await loader();
    } catch (error) {
        msg(error.message || 'Unable to refresh records.', 'error');
    } finally {
        button.textContent = 'Refresh section';
        button.disabled = !sectionMap[activeSection];
    }
});

 const enrollmentContext=en=>`${en.program} · ${en.status.replaceAll('_',' ')}\nEnrollment: ${en.id}\nStudent account: ${en.student_user_id||'Not supplied by server'}`;
 function renderApps(items){const host=$('applications');host.replaceChildren();if(!items?.length){host.append(el('div','No applications found.','staff-empty'));count('applications',0);return;}for(const a of items){const card=document.createElement('article');card.className='admin-item staff-app-grid';record(card,a.status,[a.full_name,a.application_ref,a.email,a.program,a.country].join(' '));const left=el('div'),right=el('div',undefined,'staff-decision');card.append(left,right);const title=el('h3',a.full_name);left.append(title,el('p',a.application_ref,'small-muted'));const info=document.createElement('p');info.textContent=`${a.email} | ${a.phone||'No phone'} | ${a.country||'No country'} | ${a.program}`;left.append(fields({email:a.email,phone:a.phone,country:a.country,program:a.program}));const status=document.createElement('p');const badge=document.createElement('span');badge.className='admin-badge';badge.textContent=a.status;status.append(badge);left.append(status);const date=document.createElement('p');date.className='small-muted';date.textContent=`Submitted: ${new Date(a.submitted_at).toLocaleString()}${a.decided_at?' · Last decision: '+new Date(a.decided_at).toLocaleString():''}`;left.append(date);right.append(el("h3","Application decision"));const reason=document.createElement('textarea');reason.placeholder='Decision note / reason (optional; required for rejection recommended)';reason.value=a.decision_reason||'';reason.setAttribute('aria-label','Decision reason');right.append(reason);const controls=document.createElement('div');controls.className='admin-row';const sel=document.createElement('select');for(const s of [...new Set([a.status,'Under Review','Needs Information','Accepted','Rejected'])]){const op=document.createElement('option');op.value=s;op.textContent=s;op.selected=s===a.status;sel.append(op);}controls.append(sel,button('Save decision',async()=>{try{if(sel.value==='Rejected'&&reason.value.trim().length<5){msg('Please provide a reason before rejecting an application.','error');return;}if(sel.value===a.status){msg('Choose a different application decision.','error');return;}if(!await workflowDialog('Confirm admission decision','This changes the official application status.',a.full_name+' · '+sel.value,[],'#166534','Save decision'))return;const desired=sel.value;const saved=await api('decide_application',{id:a.id,status:desired,expected_status:a.status,reason:reason.value.trim()});if(saved.item?.status!==desired)throw Error('The admission decision could not be verified. Refresh before retrying.');const fresh=await api('list_applications');renderApps(fresh.items);if(!fresh.items?.some(x=>x.id===a.id&&x.status===desired))throw Error('Decision returned but could not be verified in the refreshed list.');msg(`Application ${a.application_ref} decision saved: ${desired}.`, 'success');}catch(e){msg(e.message,'error');}}));right.append(controls);const workflow=document.createElement('div');workflow.className='admin-row';if(!a.linked_user_id)workflow.append(button('Link verified student account by email',async()=>{try{await api('link_application_user',{id:a.id});msg('Student account linked. The application will appear in that account’s Student Portal.','success');await loadApps();await loadEnrollments();}catch(e){msg(e.message,'error');}}));if(a.status==='Accepted'&&a.linked_user_id)workflow.append(button('Create enrollment',async()=>{const choice=await workflowDialog('Create student enrollment','Select the start date. The existing backend determines the enrollment duration.',a.program+' · '+a.full_name,[{key:'start',label:'Enrollment start date',type:'date',value:new Date().toISOString().slice(0,10)}]);if(!choice)return;const start=choice.start;try{await api('create_enrollment',{application_id:a.id,start_date:start});msg('Enrollment created in pending-payment status.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}));right.append(workflow);const payload=document.createElement('details');const sum=document.createElement('summary');sum.textContent='Submitted application details';payload.append(sum);payload.append(fields(a.payload));left.append(payload);const docsBox=document.createElement('details');const docsTitle=document.createElement('summary');docsTitle.textContent='Private supporting documents';docsBox.append(docsTitle);const docsHost=document.createElement('div');docsHost.className='admin-list';const docsBtn=button('Load document list',async()=>{try{const d=await api('list_application_documents',{application_id:a.id});docsHost.replaceChildren();if(!d.items?.length){docsHost.textContent='No files uploaded.';}for(const doc of d.items||[]){const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=`${doc.original_filename} · ${(doc.byte_size/1024).toFixed(0)} KB`;row.append(label,button('Open secure link (60 sec)',async()=>{const tab=window.open('about:blank','_blank');try{const link=await api('get_document_url',{id:doc.id});if(tab){tab.opener=null;tab.location.href=link.url;}else{const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open signed document link';row.append(a);}}catch(e){if(tab)tab.close();msg(e.message,'error');}}));docsHost.append(row);}docsBtn.disabled=true;}catch(e){msg(e.message,'error');}});docsBox.append(docsBtn,docsHost);left.append(docsBox);host.append(card);}count("applications",items.length);}
 function renderReceipts(items) {
   const host = $('receipts');
   host.replaceChildren();
   const rows = items || [];
   const make = (tag, text, cls) => {
     const el = document.createElement(tag);
     if (text !== undefined) el.textContent = text;
     if (cls) el.className = cls;
     return el;
   };
   const groups = [
     ['pending_review', 'Pending review', '#92400e', '#fff4db'],
     ['approved', 'Approved receipts', '#166534', '#e7f5ec'],
     ['rejected', 'Rejected receipts', '#991b1b', '#fdecec']
   ];
   if (rows.some(r => !groups.some(g => g[0] === r.status))) {
     groups.push(['other', 'Other receipt statuses', '#334155', '#eef2f7']);
   }
   const actionButton = (label, handler, color) => {
     const b = button(label, handler, 'btn');
     Object.assign(b.style, {background:color, color:'#fff', border:'1px solid '+color, fontWeight:'700'});
     return b;
   };
   function confirmReview(r, decision, reason) {
     return new Promise(resolve => {
       const approved = decision === 'approved';
       const dialog = make('dialog');
       Object.assign(dialog.style, {width:'min(520px, 90vw)', maxHeight:'85vh', overflow:'auto', border:'1px solid #d6e2ed', borderRadius:'16px', padding:'24px', color:'#102c49', background:'#fff', boxShadow:'0 20px 70px #0005'});
       const heading = make('h2', approved ? 'Confirm payment approval' : 'Confirm receipt rejection');
       heading.id = 'sifa-review-dialog-title';
       dialog.setAttribute('aria-labelledby', heading.id);
       const check = make('input'); check.type='checkbox';
       const label = make('label'); label.append(check, document.createTextNode(approved ? ' I confirm that the payment has been independently verified against SIFA payment records.' : ' I confirm that the rejection reason is accurate.'));
       const proceed = actionButton(approved ? 'Confirm approval' : 'Confirm rejection', () => dialog.close('yes'), approved ? '#166534' : '#b91c1c');
       proceed.disabled = true;
       proceed.style.opacity = '.55';
       check.addEventListener('change', () => {proceed.disabled = !check.checked; proceed.style.opacity = check.checked ? '1' : '.55';});
       const controls = make('div', undefined, 'admin-row'); controls.append(button('Cancel', () => dialog.close('no')), proceed);
       dialog.append(make('p','SIFA GLOBAL INSTITUTE · FINANCIAL ADMINISTRATION','small-muted'), heading,
         make('p', `${r.claimed_amount} ${r.claimed_currency} · ${r.payment_method}`),
         make('p', `Reference: ${r.transaction_reference || 'Not provided'}`),
         make('p', `Invoice: ${r.invoice_id}`),
         make('p', approved ? 'Approval marks the invoice paid and records your decision. Separate classroom authorization remains required. Certificate payments do not unlock classroom access.' : 'Rejection returns the invoice to unpaid status so corrected evidence can be submitted. Existing valid classroom entitlements are not automatically cancelled.'),
         make('p', `Review note: ${reason || 'Not provided'}`), label,
         make('p','This decision is recorded in the audit log and cannot be reversed through ordinary receipt review.','small-muted'), controls);
       dialog.addEventListener('close', () => {const accepted=dialog.returnValue==='yes';dialog.remove();resolve(accepted);}, {once:true});
       document.body.append(dialog);
       try {dialog.showModal();} catch (e) {dialog.remove();resolve(false);msg('Unable to open confirmation. Please refresh and try again.','error');}
     });
   }
   const intro = make('p', 'Review pending payments first. Completed decisions are kept separately for reference. Counts reflect the receipts returned by the server.', 'small-muted');
   host.append(intro);
   for (const [key,title,color,bg] of groups) {
     const records = rows.filter(r => key==='other' ? !['pending_review','approved','rejected'].includes(r.status) : r.status===key);
     const folder = make('details'); folder.open = key==='pending_review';
     Object.assign(folder.style,{border:'1px solid #d6e2ed',borderRadius:'12px',margin:'12px 0',overflow:'hidden'});
     const summary = make('summary', `${title} (${records.length})`);
     Object.assign(summary.style,{background:bg,color,padding:'16px',fontWeight:'700',cursor:'pointer'});
     const body = make('div'); body.style.padding='12px'; folder.append(summary,body);host.append(folder);
     if (!records.length) body.append(make('p','No receipts in this section.','small-muted'));
     for (const r of records) {
       const card = make('article',undefined,'admin-item');record(card,r.status,[r.id,r.invoice_id,r.sender_full_name,r.student_user_id,r.transaction_reference,r.claimed_currency].join(' '));
       const status = make('span',key==='other'?String(r.status):key==='pending_review'?'Pending review':key==='approved'?'Approved':'Rejected');
       Object.assign(status.style,{display:'inline-block',background:bg,color,borderRadius:'6px',padding:'4px 10px',fontWeight:'700'});
       card.append(status,make('h3',`Receipt ${r.id}`),make('p',`${r.claimed_amount} ${r.claimed_currency} · ${r.payment_method}`),
         make('p',`Invoice: ${r.invoice_id}`,'small-muted'),make('p',`Transaction reference: ${r.transaction_reference || 'Not provided'}`),
         make('h4','Payment sender information'),make('p',`Sender's full name: ${r.sender_full_name || 'Not provided'}`),
         make('p',`Sender's contact: ${r.sender_contact || 'Not provided'}`),
         make('p',`Relationship to student: ${r.sender_relationship==='self'?'Self (the student)':r.sender_relationship || 'Not provided'}`),
         make('p',`Student account ID: ${r.student_user_id || 'Not available'}`,'small-muted'),
         make('p',`Payment quote: ${r.payment_quote_id || 'No quote associated'}`,'small-muted'));
       if (r.submitted_at) card.append(make('p',`Submitted: ${new Date(r.submitted_at).toLocaleString()}`,'small-muted'));
       card.append(button('Open private receipt (60 sec)',async()=>{
         const tab=window.open('about:blank','_blank');
         if(tab) tab.opener=null;
         try{const link=await api('get_receipt_url',{id:r.id});if(tab)tab.location.href=link.url;else{const a=make('a','Open signed receipt link');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}
         catch(e){if(tab)tab.close();msg(e.message,'error');}
       }));
       if (r.status==='pending_review') {
         const note=make('textarea');note.placeholder='Verification note / required rejection reason';note.maxLength=2000;note.setAttribute('aria-label','Receipt review note');card.append(note);
         const feedback=make('p');feedback.setAttribute('role','status');card.append(feedback);
         let busy=false;
         async function review(decision){
           if(busy)return;
           const reason=note.value.trim();
           if(decision==='rejected'&&reason.length<5){feedback.textContent='Please enter a clear rejection reason (at least five characters).';note.focus();return;}
           busy=true;approve.disabled=reject.disabled=true;
           try{
             if(!await confirmReview(r,decision,reason))return;
             await api('review_receipt',{id:r.id,status:decision,note:reason});
             await loadEnrollments();await loadReceipts();
             msg(decision==='approved'?'Payment approved. Invoice marked paid; separate classroom authorization remains required.':'Receipt rejected. Invoice returned to unpaid status.','success');
           }catch(e){feedback.textContent=e.message;msg(e.message,'error');}
           finally{busy=false;approve.disabled=reject.disabled=false;}
         }
         const approve=actionButton('Approve payment',()=>review('approved'),'#166534');
         const reject=actionButton('Reject receipt',()=>review('rejected'),'#b91c1c');
         const controls=make('div',undefined,'admin-row');controls.append(approve,reject);card.append(controls);
       }else{
         if(r.reviewed_at)card.append(make('p',`Reviewed: ${new Date(r.reviewed_at).toLocaleString()}`,'small-muted'));
         card.append(make('p',r.reviewer_note===undefined?'Review note not included in the current server response.':`Review note: ${r.reviewer_note || 'No note recorded'}`,'small-muted'));
       }
       body.append(card);
     }
   }
 }
 const enrollmentNotices=new Map();
 function renderEnrollments(items){
  const host=$('enrollments');const openIds=new Set([...host.querySelectorAll('details[data-enrollment-id][open]')].map(d=>d.dataset.enrollmentId));const openPrograms=new Set([...host.querySelectorAll('details[data-program][open]')].map(d=>d.dataset.program));host.replaceChildren();if(!items?.length){host.append(el('div','No enrollments found.','staff-empty'));count('enrollments',0);return;}
  const groups=new Map();
  for(const en of items){const key=en.program||'Unspecified program';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(en);}
  for(const [program,records] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
   const folder=document.createElement('details');folder.dataset.program=program;folder.open=groups.size===1||openPrograms.has(program);folder.style.cssText='border:1px solid #d6e2ed;border-radius:12px;margin:12px 0;padding:12px';const summary=document.createElement('summary');summary.textContent=program+' ('+records.length+')';summary.style.cssText='font-weight:700;color:#123c62;cursor:pointer;padding:8px';folder.append(summary);host.append(folder);
   for(const en of records){
   const localMessage=(text,type)=>{if(type==='success')enrollmentNotices.set(en.id,{text,time:new Date().toLocaleString()});local.textContent=text;local.style.color=type==='error'?'#b91c1c':'#166534';msg(text,type);};const card=document.createElement('article');card.className='admin-item';const h=document.createElement('h3');h.textContent=en.student_name||'Student account';card.append(h);record(card,en.status,[en.student_name,en.student_email,en.student_user_id,en.id,en.program,en.status].join(' '));
   const p=document.createElement('p');p.textContent=`Enrollment ID: ${en.id} · Status: ${en.status} · ${en.start_date||'No start date'} to ${en.end_date||'No end date'}`;card.append(p,el('p',en.student_email||('Student account ID: '+en.student_user_id),'small-muted'));
   const controls=document.createElement('div');controls.className='admin-row';
   if(en.status==='pending_payment'&&['administrator','coordinator'].includes(currentRole)) controls.append(button('Activate after verified payment / waiver',async()=>{if(!await workflowDialog('Activate enrollment','Activate only after verifying payment or an authorized fee waiver.',enrollmentContext(en),[],'#166534','Activate enrollment','I have verified the payment or waiver.'))return;try{await api('set_enrollment_status',{id:en.id,status:'active',reason:'Manually activated after verified payment/waiver'});localMessage('Enrollment activated.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
   const authorization=document.createElement('p');authorization.textContent=en.classroom_access_authorized?'Classroom authorization: Granted (financial eligibility still required)':'Classroom authorization: Not granted';authorization.style.cssText='font-weight:600;color:'+(en.classroom_access_authorized?'#166534':'#9f2722');card.append(authorization);
   if(en.access_exception_expires_at){const grace=document.createElement('p');const expiry=new Date(en.access_exception_expires_at);grace.textContent='Grace period: '+(expiry>new Date()?'Expires ':'Expired ')+expiry.toLocaleString();card.append(grace);}
   if(currentRole==='administrator'){
    if(['active','pending_payment'].includes(en.status)&&!en.classroom_access_authorized)controls.append(button('Grant classroom authorization',async()=>{const choice=await workflowDialog('Grant classroom authorization','Authorize this program only. Payment, waiver or a valid grace period is still required.',enrollmentContext(en),[{key:'reason',label:'Reason for authorization',type:'textarea',minLength:8}]);if(!choice)return;try{await api('grant_classroom_access',{id:en.id,reason:choice.reason});localMessage('Classroom authorization granted.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
    if(['active','pending_payment'].includes(en.status))controls.append(button('Authorize temporary exception',async()=>{const choice=await workflowDialog('Authorize temporary classroom access','Grant classroom authorization and a time-limited grace period. No invoice is marked paid.',enrollmentContext(en),[{key:'reason',label:'Reason (at least 8 characters)',type:'textarea',minLength:8},{key:'expiry',label:'Expiry date and time (local time)',type:'datetime-local'}],'#925b09','Authorize grace period');if(!choice)return;try{await api('authorize_access_exception',{id:en.id,reason:choice.reason,expires_at:new Date(choice.expiry).toISOString()});localMessage('Temporary classroom access authorized.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
    if(en.classroom_access_authorized)controls.append(button('Revoke classroom authorization',async()=>{const choice=await workflowDialog('Revoke classroom authorization','Block classroom access without changing tuition records.',enrollmentContext(en),[{key:'reason',label:'Reason for revocation',type:'textarea',minLength:8}],'#b91c1c','Revoke access');if(!choice)return;try{await api('revoke_classroom_access',{id:en.id,reason:choice.reason});localMessage('Classroom authorization revoked.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
   }
   if(en.status==='active'){
    if(['administrator','coordinator'].includes(currentRole))controls.append(button('Suspend access',async()=>{const choice=await workflowDialog('Suspend classroom access','Suspend this enrollment’s classroom access. Existing financial records are retained.',enrollmentContext(en),[{key:'reason',label:'Reason for suspension',type:'textarea',minLength:8}],'#b91c1c','Confirm suspension');if(!choice)return;const reason=choice.reason;try{await api('set_enrollment_status',{id:en.id,status:'suspended',reason});localMessage('Enrollment suspended.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}),button('Mark course completed',async()=>{if(!await workflowDialog('Mark course completed','Confirm that the student has met the academic completion requirements. Completion is separate from certificate issuance.',enrollmentContext(en),[],'#166534','Confirm completion','I have verified the academic completion criteria.'))return;try{await api('set_enrollment_status',{id:en.id,status:'completed',reason:'Completion criteria verified by staff'});localMessage('Enrollment marked completed.','success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
   }
   if(en.status==='completed'){
    if(['administrator','finance_reviewer'].includes(currentRole))controls.append(button('Create 5,000 RWF certificate-fee invoice',async()=>{if(!await workflowDialog('Create certificate fee invoice','Create an optional 5,000 RWF certificate invoice. Monthly scholarship discounts do not apply.',enrollmentContext(en),[],'#166534','Create invoice'))return;try{const r=await api('create_certificate_invoice',{enrollment_id:en.id});localMessage(`Certificate fee invoice created: ${r.item.id}. The student must pay it and the receipt must be approved before certificate issuance.`, 'success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
    if(['administrator','coordinator'].includes(currentRole))controls.append(button('Issue certificate',async()=>{const choice=await workflowDialog('Issue certificate','Verify the student’s name, completion and certificate payment before issuing a credential.',enrollmentContext(en),[{key:'name',label:'Name on certificate'},{key:'code',label:'Unique certificate code'}],'#166534','Issue certificate','I have verified the issuance requirements.');if(!choice)return;const {name,code}=choice;try{const r=await api('issue_certificate',{enrollment_id:en.id,student_display_name:name,program:en.program,certificate_code:code});localMessage(`Certificate issued: ${r.item.certificate_code}. Save this code for public verification.`, 'success');await loadCertificates();await loadEnrollments();}catch(e){localMessage(e.message,'error');}}));
   }
   card.append(controls);for(const b of controls.querySelectorAll('button')){const color=b.textContent==='Suspend access'?'#b91c1c':b.textContent==='Authorize temporary exception'?'#925b09':b.textContent.includes('Activate')||b.textContent.includes('completed')||b.textContent.includes('Issue')?'#166534':null;if(color)Object.assign(b.style,{background:color,color:'#fff',border:'1px solid '+color});} const local=document.createElement('p');local.setAttribute('role','status');local.style.cssText='font-weight:600;color:#166534';const notice=enrollmentNotices.get(en.id);if(notice)local.textContent=notice.text+' · '+notice.time;card.append(local);
   if(['administrator','finance_reviewer'].includes(currentRole)&&['active','suspended','pending_payment'].includes(en.status)){
    const invoiceForm=document.createElement('form');invoiceForm.className='admin-row staff-invoice';invoiceForm.style.marginTop='10px';
    const month=document.createElement('input');month.type='month';month.required=true;month.value=new Date().toISOString().slice(0,7);month.setAttribute('aria-label','Invoice month');
    const amount=document.createElement('input');amount.type='number';amount.min='0.01';amount.step='0.01';amount.required=true;amount.placeholder='Base fee';amount.style.maxWidth='150px';amount.setAttribute('aria-label','Monthly base fee');
    const currency=document.createElement('select');currency.setAttribute('aria-label','Invoice currency');for(const cur of ['RWF','TRY','USD']){const o=document.createElement('option');o.value=cur;o.textContent=cur;currency.append(o);}
    const submit=document.createElement('button');submit.type='submit';submit.className='btn btn-primary';submit.textContent='Create monthly invoice';for(const [label,input] of [['Billing month',month],['Base fee',amount],['Currency',currency]]){const l=el('label',label);l.append(input);invoiceForm.append(l);}invoiceForm.append(submit);
    invoiceForm.addEventListener('submit',async ev=>{ev.preventDefault();try{const period=month.value+'-01';if(!await workflowDialog('Create monthly invoice','Verify the billing month, currency and base fee. The server applies eligible scholarship discounts.',enrollmentContext(en)+'\nBilling month: '+month.value+' · '+amount.value+' '+currency.value,[],'#166534','Create invoice'))return;const result=await api('create_monthly_invoice',{enrollment_id:en.id,period_start:period,currency:currency.value,base_amount:Number(amount.value)});localMessage(`Invoice created. Amount due: ${result.item.amount_due} ${result.item.currency}. Any approved monthly scholarship discount was applied.`, 'success');await loadEnrollments();}catch(e){localMessage(e.message,'error');}});card.append(invoiceForm);
   }
   const outer=fold((en.student_name||('Account '+String(en.student_user_id||'').slice(0,8)))+" · "+pretty(en.status)+" · "+(en.classroom_access_authorized?"Authorized":"Not authorized"),card);outer.dataset.enrollmentId=en.id;outer.open=openIds.has(en.id);outer.dataset.search=card.dataset.search;outer.dataset.status=card.dataset.status;delete card.dataset.search;delete card.dataset.status;folder.append(outer);
   const history=el('div');history.style.cssText='margin-top:16px;border-top:1px solid #d6e2ed;padding-top:12px';card.append(history);
   const historyBody=el('div');const refreshHistory=button('Refresh enrollment history',()=>loadHistory());history.append(el('h3','Invoices and administrative activity'),refreshHistory,historyBody);
   let historyLoading=false,historyLoaded=false;
   async function loadHistory(){if(historyLoading)return;historyLoading=true;refreshHistory.disabled=true;historyBody.replaceChildren(el('p','Loading verified records…'));
    try{const r=await api('get_enrollment_history',{id:en.id});if(!historyBody.isConnected)return;historyBody.replaceChildren();
      if(r.invoices!==null){historyBody.append(el('h4','Invoice history'));
      if(!r.invoices?.length)historyBody.append(el('p','No invoices have been issued for this enrollment.','small-muted'));
      for(const i of r.invoices||[]){const row=el('div',undefined,'staff-field');row.append(el('strong',pretty(i.invoice_type)+' · '+pretty(i.status)),fields({period_start:i.period_start,period_end:i.period_end,base_fee:i.base_amount+' '+i.currency,discount:i.discount_amount+' '+i.currency,amount_due:i.amount_due+' '+i.currency,invoice_id:i.id}));historyBody.append(row);}
      if(r.invoices_more)historyBody.append(el('p','Showing the latest 100 invoices.','small-muted'));}
      if(r.activity!==null){historyBody.append(el('h4','Administrative activity'));if(!r.activity?.length)historyBody.append(el('p','No audit entries were returned for this enrollment.','small-muted'));
        const labels={enrollment_created:'Enrollment created',enrollment_status_changed:'Enrollment status changed',classroom_authorization_grant:'Classroom authorization granted',classroom_authorization_revoke:'Classroom authorization revoked',classroom_authorization_grace:'Temporary access authorized',monthly_invoice_created:'Monthly invoice created',certificate_fee_invoice_created:'Certificate fee invoice created'};
        for(const a of r.activity||[]){const row=el('div',undefined,'staff-field');row.append(el('strong',(labels[a.action]||pretty(a.action))+(a.status?' · '+pretty(a.status):'')),el('p',new Date(a.created_at).toLocaleString()+' · '+(a.actor_name||a.actor_user_id||'Actor unavailable'),'small-muted'));if(a.reason)row.append(el('p',a.reason));historyBody.append(row);}
        if(r.activity_more)historyBody.append(el('p','Showing recent audit entries only.','small-muted'));}
      historyLoaded=true;
    }catch(e){historyBody.replaceChildren(el('p',e.message||'Unable to load history.'));}finally{historyLoading=false;refreshHistory.disabled=false;}}
   outer.addEventListener('toggle',()=>{if(outer.open&&!historyLoaded)loadHistory();});if(outer.open)loadHistory();
  }
 }
 count("enrollments",items.length);
 }

async function loadEnrollments() {
  try {
    msg("Loading student enrollments…");

    const result = await api("list_enrollments");
    const items = result.items || [];

    renderEnrollments(items);

    msg(
      `Loaded ${items.length} student enrollments.`,
      "success"
    );
  } catch (error) {
    msg(error.message || "Failed to load enrollments.", "error");
  }
}

 async function loadApps(){try{msg('Loading applications…');const b=await api('list_applications');renderApps(b.items);msg(`Loaded ${b.items?.length||0} applications.`,'success');}catch(e){msg(e.message,'error');}}
 async function loadReceipts(){try{msg('Loading payment receipts…');const b=await api('list_receipts');renderReceipts(b.items);count('receipts',b.items?.length||0);msg(`Loaded ${b.items?.length||0} receipts.`,'success');}catch(e){msg(e.message,'error');}}
 
async function loadScholarships() {
  try {
    msg('Loading scholarship requests…');

    const result = await api('list_scholarships');
    const items = result.items || [];
    const host = $('scholarships');

    host.replaceChildren();

    if (items.length === 0) {
      host.textContent = 'No scholarship requests found.';
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'admin-item';

      const title = document.createElement('h3');
      title.textContent =
        item.applicant?.full_name ||
        item.applicant?.email ||
        'Scholarship request';

      record(card,item.decision,[title.textContent,item.applicant?.application_ref,item.applicant?.program,item.applicant?.email].join(' '));
      card.append(title,fields({application_ref:item.applicant?.application_ref,program:item.applicant?.program,decision:item.decision,monthly_discount_percent:item.monthly_discount_percent,starts_on:item.starts_on,ends_on:item.ends_on}),fold('Review request and supporting information',fields(item)));
      if(item.decision==='pending' && ['administrator','coordinator'].includes(currentRole)){
        const actions=el('div',undefined,'staff-actions');
        for(const decision of ['approved','rejected'])actions.append(button(decision==='approved'?'Approve scholarship / waiver':'Reject request',async()=>{const f=[{key:'reason',label:'Decision reason',type:'textarea',minLength:8}];if(decision==='approved')f.unshift({key:'percent',label:'Monthly discount (%) — 100 for full waiver',type:'number'},{key:'start',label:'Start date',type:'date'},{key:'end',label:'End date',type:'date'});const c=await workflowDialog('Scholarship decision', 'Discounts apply to monthly tuition, not certificate fees.',title.textContent,f);if(!c)return;const percent=decision==='approved'?Number(c.percent):0;if(decision==='approved'&&(!Number.isFinite(percent)||percent<=0||percent>100||c.end<c.start)){msg('Enter a discount greater than zero up to 100% and valid dates.','error');return;}try{await api('decide_scholarship',{id:item.id,decision,monthly_discount_percent:percent,starts_on:c.start||null,ends_on:c.end||null,reason:c.reason});await loadScholarships();}catch(e){msg(e.message,'error');}}));card.append(actions);
      }
      host.append(card);
    }

    count('scholarships',items.length);msg(`Loaded ${items.length} scholarship requests.`, 'success');
  } catch (error) {
    msg(error.message || 'Could not load scholarships.', 'error');
  }
}

async function loadCertificates() {
  try {
    msg('Loading certificates…');

    const result = await api('list_certificates');
    const items = result.items || [];
    const host = $('certificates');

    host.replaceChildren();

    if (items.length === 0) {
      host.textContent = 'No certificate records found.';
    }

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'admin-item';

      const title = document.createElement('h3');
      title.textContent =
        item.certificate_code || 'Certificate record';

      record(card,item.status,Object.values(item).join(' '));card.append(title,fields(item));
      host.append(card);
    }

    count('certificates',items.length);msg(`Loaded ${items.length} certificates.`, 'success');
  } catch (error) {
    msg(error.message || 'Could not load certificates.', 'error');
  }
}


  // Payment quote approval: existing staff authentication and protected admin API.
  // This does not submit or approve a payment receipt.
  const quoteForm = $('quoteApprovalForm');
  const quoteCard = $('admin-payment-quotes');
  const quoteSubmit = $('quoteApproveButton');
  const quoteIds = [
    'quoteInvoiceId', 'quotePaymentCurrency', 'quotePayableAmount',
    'quoteExchangeRate', 'quoteValidUntil', 'quoteApprovalNote'
  ];
  const quoteMethods = {
    RWF: 'Rwanda Mobile Money',
    TRY: 'Ziraat Bank Transfer',
    USD: 'Ziraat USD Bank Transfer'
  };
  function quoteMessage(text, type = '') {
    const el = $('quoteMessage');
    if (!el) return;
    el.textContent = text;
    el.className = 'admin-message' + (type ? ' ' + type : '');
  }
  function setQuoteAccess(enabled) {
    if (!quoteCard || !quoteForm || !quoteSubmit) return;
    quoteCard.classList.toggle('hidden', !enabled);
    for (const id of quoteIds) {
      const el = $(id);
      if (!el) continue;
      el.disabled = !enabled;
      if (id === 'quoteInvoiceId') el.readOnly = !enabled;
    }
    quoteSubmit.disabled = !enabled;
    quoteSubmit.textContent = 'Approve payment quote';
    if (enabled) {
      quoteMessage('Administrator access confirmed. Enter an existing unpaid invoice ID and a staff-approved conversion amount. Approving a quote does not mark the invoice paid.');
    }
  }
  setQuoteAccess(false);
  if (quoteForm) quoteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (currentRole !== 'administrator' || !session) {
      quoteMessage('Administrator sign-in is required.', 'error');
      return;
    }
    if (!quoteForm.reportValidity()) return;
    const fd = new FormData(quoteForm);
    const invoiceId = String(fd.get('invoice_id') || '').trim();
    const currency = String(fd.get('payment_currency') || '');
    const amount = Number(fd.get('payable_amount'));
    const rate = Number(fd.get('exchange_rate'));
    const expiry = String(fd.get('valid_until') || '');
    const note = String(fd.get('approval_note') || '').trim();
    const expiryDate = new Date(expiry);
    const now = Date.now();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(invoiceId) || !quoteMethods[currency] ||
        !Number.isFinite(amount) || amount <= 0 ||
        !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(expiryDate.getTime()) ||
        expiryDate.getTime() <= now || expiryDate.getTime() > now + 7 * 86400000 ||
        note.length < 10 || note.length > 1000) {
      quoteMessage('Check the invoice ID, approved amount, exchange rate, expiry (within 7 days), and approval note.', 'error');
      return;
    }
    // The invoice and matching exchange amount are independently checked by SQL.
    const ok = await workflowDialog('Approve payment quote','Verify the conversion amount and rate. This does not confirm payment.',
      `Approve a payment quote for invoice ${invoiceId}?\n\n` +
      `Method: ${quoteMethods[currency]}\n` +
      `Payable: ${amount} ${currency}\n` +
      `Rate: ${rate} ${currency} per invoice currency unit\n\n` +
      'Confirm this amount and rate have been verified by SIFA. This does NOT confirm payment.', [], '#166534', 'Approve quote', 'I have verified the amount and exchange rate.'
    );
    if (!ok) return;
    quoteSubmit.disabled = true;
    quoteSubmit.textContent = 'Approving securely…';
    try {
      const result = await api('approve_payment_quote', {
        invoice_id: invoiceId,
        payment_method: quoteMethods[currency],
        payment_currency: currency,
        payable_amount: amount,
        exchange_rate: rate,
        valid_until: expiryDate.toISOString(),
        approval_note: note
      });
      quoteForm.reset();
      quoteMessage(`Quote approved. Reference: ${result.quote_id}. No payment has been confirmed.`, 'success');
    } catch (error) {
      quoteMessage(error.message || 'Quote approval failed.', 'error');
    } finally {
      if (currentRole === 'administrator' && session) {
        quoteSubmit.disabled = false;
        quoteSubmit.textContent = 'Approve payment quote';
      }
    }
  });

 let uiQueue=Promise.resolve();function updateUI(){uiQueue=uiQueue.catch(()=>{}).then(refreshUI);return uiQueue;} async function refreshUI(){enrollmentNotices.clear();const {data}=await sb.auth.getSession();session=data.session;if(!session){currentRole='';loadedCounts={};$('staffKpis').replaceChildren();$('staffWelcome').textContent='Staff Administration Portal';for(const id of Object.keys(sectionMap))$(id).replaceChildren();setQuoteAccess(false);$('loginCard').classList.remove('hidden');$('console').classList.add('hidden');return;} $('console').classList.add('hidden');currentRole='';loadedCounts={};$('staffKpis').replaceChildren();for(const id of Object.keys(sectionMap))$(id).replaceChildren();$('staffWelcome').textContent='Staff Administration Portal';try{const me=await api('whoami');currentRole=me.role;const name=String(me.full_name||session.user.user_metadata?.full_name||session.user.user_metadata?.name||'').trim();$('staffIdentity').textContent=name||'Staff member — name not set';$('staffWelcome').textContent=name?'Welcome, '+name:'Staff Administration Portal';$('staffRole').textContent=pretty(currentRole);$('staffEmail').textContent=session.user.email||'';$('staffAvatar').textContent=name?name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase():'S';setQuoteAccess(currentRole==='administrator');}catch(e){setQuoteAccess(false);$('loginCard').classList.remove('hidden');msg(e.message,'error');return;}$('loginCard').classList.add('hidden');$('console').classList.remove('hidden');const canApps=['administrator','coordinator'].includes(currentRole),canFinance=['administrator','finance_reviewer'].includes(currentRole),canEnroll=['administrator','coordinator','finance_reviewer'].includes(currentRole),canScholar=['administrator','coordinator'].includes(currentRole),canCert=['administrator','coordinator'].includes(currentRole);const hideCard=(id,hide)=>{$(id).closest('.admin-card').classList.toggle('hidden',hide);};hideCard('applications',!canApps);hideCard('receipts',!canFinance);hideCard('enrollments',!canEnroll);hideCard('scholarships',!canScholar);hideCard('certificates',!canCert);$('refreshApps').classList.toggle('hidden',!canApps);$('refreshReceipts').classList.toggle('hidden',!canFinance);$('refreshEnrollments').classList.toggle('hidden',!canEnroll);$('refreshScholarships').classList.toggle('hidden',!canScholar);$('refreshCertificates').classList.toggle('hidden',!canCert);$('staffClassroom').classList.toggle('hidden',!['administrator','coordinator','instructor'].includes(currentRole));for(const a of document.querySelectorAll('.sifa-shortcuts a'))a.classList.toggle('hidden',$(a.hash.slice(1)).classList.contains('hidden'));const allowed=[...document.querySelectorAll('.sifa-shortcuts a:not(.hidden)')];if(allowed.length)selectSection(allowed.some(a=>a.hash==='#admin-'+activeSection)?activeSection:allowed[0].hash.slice(7));$('staffSearch').disabled=!allowed.length||!sectionMap[activeSection];$('staffStatus').disabled=$('staffSearch').disabled;$('staffRefresh').disabled=$('staffSearch').disabled;const jobs=[];if(canApps)jobs.push(loadApps());if(canFinance)jobs.push(loadReceipts());if(canEnroll)jobs.push(loadEnrollments());if(canScholar)jobs.push(loadScholarships());if(canCert)jobs.push(loadCertificates());await Promise.all(jobs);}
 $('staffProfile').addEventListener('click',async()=>{const c=await workflowDialog('My staff profile','Update your display name. Your verified staff role cannot be changed here.',session?.user?.email||'',[{key:'name',label:'Full name',value:session?.user?.user_metadata?.full_name||session?.user?.user_metadata?.name||'',minLength:2}]);if(!c)return;try{const {error}=await sb.auth.updateUser({data:{full_name:c.name}});if(error)throw error;await updateUI();msg('Display name updated.','success');}catch(e){msg(e.message,'error');}});
 // SIFA authentication loading feedback (UI only).
  let sifaAuthPending = false;
  function sifaAuthLoading(label, handler, onFailure) {
    return async function (event) {
      event.preventDefault();
      if (sifaAuthPending) return;
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      if (!button) return handler(event);
      sifaAuthPending = true;
      const original = Array.from(button.childNodes);
      const wasDisabled = button.disabled;
      const priorBusy = form.getAttribute('aria-busy');
      const controls = Array.from(form.querySelectorAll('button')).map(b => [b, b.disabled]);
      const status = document.createElement('span');
      status.className = 'sifa-auth-live';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      try {
        if (!document.getElementById('sifa-auth-loading-style')) {
          const style = document.createElement('style');
          style.id = 'sifa-auth-loading-style';
          style.textContent = '.sifa-auth-spinner{display:inline-block;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;box-sizing:border-box;vertical-align:-.12em;margin-inline-end:.55em;animation:sifa-auth-spin .8s linear infinite}.sifa-auth-live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}@keyframes sifa-auth-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.sifa-auth-spinner{animation:none}}';
          document.head.append(style);
        }
        const spinner = document.createElement('span');
        spinner.className = 'sifa-auth-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        form.after(status);
        form.setAttribute('aria-busy', 'true');
        button.replaceChildren(spinner, document.createTextNode(label));
        controls.forEach(([b]) => { b.disabled = true; });
        status.textContent = label + ' Please wait.';
        await handler(event);
      } catch (error) {
        console.error('SIFA authentication request failed:', error);
        onFailure();
      } finally {
        button.replaceChildren(...original);
        controls.forEach(([b, disabled]) => { b.disabled = disabled; });
        button.disabled = wasDisabled;
        if (priorBusy === null) form.removeAttribute('aria-busy');
        else form.setAttribute('aria-busy', priorBusy);
        status.remove();
        sifaAuthPending = false;
      }
    };
  }
  $('loginForm').addEventListener('submit',sifaAuthLoading('Signing in…', async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{msg('Signing in…');const {error}=await sb.auth.signInWithPassword({email:String(fd.get('email')).trim(),password:String(fd.get('password'))});if(error)throw error;await updateUI();}catch(err){msg(err.message||'Sign-in failed.','error');}}, () => msg('Unable to sign in right now. Please try again.', 'error')));
 $('refreshApps').addEventListener('click',loadApps);$('refreshReceipts').addEventListener('click',loadReceipts);$('refreshEnrollments').addEventListener('click',loadEnrollments);$('refreshScholarships').addEventListener('click',loadScholarships);$('refreshCertificates').addEventListener('click',loadCertificates);$('signOut').addEventListener('click',async()=>{await sb.auth.signOut();await updateUI();msg('Signed out.','success');});sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')$('console').classList.add('hidden');if(event!=='TOKEN_REFRESHED')setTimeout(updateUI,0);});updateUI();
})();

