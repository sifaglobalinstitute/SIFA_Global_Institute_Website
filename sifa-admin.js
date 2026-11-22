(() => {
 const cfg=window.SIFA_SUPABASE_CONFIG||{};const $=id=>document.getElementById(id);const msg=(text,type='')=>{const el=$('adminMessage');el.textContent=text;el.className='admin-message'+(type?' '+type:'');};
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
 function renderApps(items){const host=$('applications');host.replaceChildren();if(!items?.length){host.textContent='No applications found.';return;}for(const a of items){const card=document.createElement('article');card.className='admin-item';const title=document.createElement('h3');title.textContent=`${a.full_name} — ${a.application_ref}`;card.append(title);const info=document.createElement('p');info.textContent=`${a.email} | ${a.phone||'No phone'} | ${a.country||'No country'} | ${a.program}`;card.append(info);const status=document.createElement('p');const badge=document.createElement('span');badge.className='admin-badge';badge.textContent=a.status;status.append(badge);card.append(status);const date=document.createElement('p');date.className='small-muted';date.textContent=`Submitted: ${new Date(a.submitted_at).toLocaleString()}${a.decided_at?' · Last decision: '+new Date(a.decided_at).toLocaleString():''}`;card.append(date);const reason=document.createElement('textarea');reason.placeholder='Decision note / reason (optional; required for rejection recommended)';reason.value=a.decision_reason||'';reason.setAttribute('aria-label','Decision reason');card.append(reason);const controls=document.createElement('div');controls.className='admin-row';const sel=document.createElement('select');for(const s of ['Under Review','Needs Information','Accepted','Rejected']){const op=document.createElement('option');op.value=s;op.textContent=s;op.selected=s===a.status;sel.append(op);}controls.append(sel,button('Save decision',async()=>{try{if(sel.value==='Rejected'&&reason.value.trim().length<5){msg('Please provide a reason before rejecting an application.','error');return;}await api('decide_application',{id:a.id,status:sel.value,reason:reason.value.trim()});msg(`Application ${a.application_ref} updated.`, 'success');await loadApps();}catch(e){msg(e.message,'error');}}));card.append(controls);const workflow=document.createElement('div');workflow.className='admin-row';workflow.append(button('Link verified student account by email',async()=>{try{await api('link_application_user',{id:a.id});msg('Student account linked. The application will appear in that account’s Student Portal.','success');await loadApps();await loadEnrollments();}catch(e){msg(e.message,'error');}}));if(a.status==='Accepted')workflow.append(button('Create 3-month enrollment',async()=>{const start=prompt('Enrollment start date (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!start)return;try{await api('create_enrollment',{application_id:a.id,start_date:start});msg('Enrollment created in pending-payment status.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}));card.append(workflow);const payload=document.createElement('details');const sum=document.createElement('summary');sum.textContent='Submitted application details';payload.append(sum);const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';pre.textContent=JSON.stringify(a.payload||{},null,2);payload.append(pre);card.append(payload);const docsBox=document.createElement('details');const docsTitle=document.createElement('summary');docsTitle.textContent='Private supporting documents';docsBox.append(docsTitle);const docsHost=document.createElement('div');docsHost.className='admin-list';const docsBtn=button('Load document list',async()=>{try{const d=await api('list_application_documents',{application_id:a.id});docsHost.replaceChildren();if(!d.items?.length){docsHost.textContent='No files uploaded.';}for(const doc of d.items||[]){const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=`${doc.original_filename} · ${(doc.byte_size/1024).toFixed(0)} KB`;row.append(label,button('Open secure link (60 sec)',async()=>{const tab=window.open('about:blank','_blank');try{const link=await api('get_document_url',{id:doc.id});if(tab)tab.location.href=link.url;else{const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open signed document link';row.append(a);}}catch(e){if(tab)tab.close();msg(e.message,'error');}}));docsHost.append(row);}docsBtn.disabled=true;}catch(e){msg(e.message,'error');}});docsBox.append(docsBtn,docsHost);card.append(docsBox);host.append(card);}}
 function renderReceipts(items){const host=$('receipts');host.replaceChildren();if(!items?.length){host.textContent='No receipts found.';return;}for(const r of items){const card=document.createElement('article');card.className='admin-item';const h=document.createElement('h3');h.textContent=`Receipt ${r.id}`;card.append(h);const p=document.createElement('p');p.textContent=`Invoice: ${r.invoice_id} | Amount: ${r.claimed_amount} ${r.claimed_currency} | Method: ${r.payment_method}`;card.append(p);const ref=document.createElement('p');ref.textContent=`Transaction reference: ${r.transaction_reference||'Not provided'} · Status: ${r.status}`;card.append(ref);const openReceipt=button('Open private receipt (60 sec)',async()=>{const tab=window.open('about:blank','_blank');try{const link=await api('get_receipt_url',{id:r.id});if(tab)tab.location.href=link.url;else{const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open signed receipt link';card.append(a);}}catch(e){if(tab)tab.close();msg(e.message,'error');}});card.append(openReceipt);const note=document.createElement('textarea');note.placeholder='Review note';note.setAttribute('aria-label','Receipt review note');card.append(note);if(r.status==='pending_review'){const controls=document.createElement('div');controls.className='admin-row';controls.append(button('Approve payment',async()=>{if(!confirm('Confirm you independently verified this payment?'))return;try{await api('review_receipt',{id:r.id,status:'approved',note:note.value.trim()});msg('Receipt approved and invoice marked paid.','success');await loadReceipts();}catch(e){msg(e.message,'error');}},'btn btn-primary'),button('Reject receipt',async()=>{if(note.value.trim().length<5){msg('Add a clear reason before rejecting a receipt.','error');return;}try{await api('review_receipt',{id:r.id,status:'rejected',note:note.value.trim()});msg('Receipt rejected; invoice returned to unpaid.','success');await loadReceipts();}catch(e){msg(e.message,'error');}}));card.append(controls);}host.append(card);}}
 function renderEnrollments(items){
  const host=$('enrollments');host.replaceChildren();if(!items?.length){host.textContent='No enrollments found.';return;}
  for(const en of items){
   const card=document.createElement('article');card.className='admin-item';const h=document.createElement('h3');h.textContent=en.program;card.append(h);
   const p=document.createElement('p');p.textContent=`Enrollment ID: ${en.id} · Status: ${en.status} · ${en.start_date||'No start date'} to ${en.end_date||'No end date'}`;card.append(p);
   const controls=document.createElement('div');controls.className='admin-row';
   if(en.status==='pending_payment'&&['administrator','coordinator'].includes(currentRole)) controls.append(button('Activate after verified payment / waiver',async()=>{if(!confirm('Activate this enrollment only if payment or a valid fee waiver is verified?'))return;try{await api('set_enrollment_status',{id:en.id,status:'active',reason:'Manually activated after verified payment/waiver'});msg('Enrollment activated.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}));
   if(en.status==='active'){
    if(currentRole==='administrator')controls.append(button('Authorize temporary exception',async()=>{const reason=prompt('Reason for temporary access exception (at least 8 characters):');if(!reason)return;const expiry=prompt('Expiry date/time in ISO format, e.g. 2026-10-30T18:00:00Z');if(!expiry)return;try{await api('authorize_access_exception',{id:en.id,reason,expires_at:expiry});msg('Temporary access exception authorized and audit logged.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}));
    if(['administrator','coordinator'].includes(currentRole))controls.append(button('Suspend access',async()=>{const reason=prompt('Reason for suspension:');if(!reason)return;try{await api('set_enrollment_status',{id:en.id,status:'suspended',reason});msg('Enrollment suspended.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}),button('Mark course completed',async()=>{if(!confirm('Confirm completion criteria have been met?'))return;try{await api('set_enrollment_status',{id:en.id,status:'completed',reason:'Completion criteria verified by staff'});msg('Enrollment marked completed.','success');await loadEnrollments();}catch(e){msg(e.message,'error');}}));
   }
   if(en.status==='completed'){
    if(['administrator','finance_reviewer'].includes(currentRole))controls.append(button('Create 5,000 RWF certificate-fee invoice',async()=>{if(!confirm('Create the optional certificate fee invoice for 5,000 RWF? Scholarship discounts do not apply to certificate fees.'))return;try{const r=await api('create_certificate_invoice',{enrollment_id:en.id});msg(`Certificate fee invoice created: ${r.item.id}. The student must pay it and the receipt must be approved before certificate issuance.`, 'success');}catch(e){msg(e.message,'error');}}));
    if(['administrator','coordinator'].includes(currentRole))controls.append(button('Issue certificate',async()=>{const name=prompt('Student name as it should appear on the certificate:');if(!name)return;const code=prompt('Unique certificate code (example SIFA-2026-ABC123):');if(!code)return;try{const r=await api('issue_certificate',{enrollment_id:en.id,student_display_name:name,program:en.program,certificate_code:code});msg(`Certificate issued: ${r.item.certificate_code}. Save this code for public verification.`, 'success');await loadCertificates();}catch(e){msg(e.message,'error');}}));
   }
   card.append(controls);
   if(['administrator','finance_reviewer'].includes(currentRole)&&['active','suspended','pending_payment'].includes(en.status)){
    const invoiceForm=document.createElement('form');invoiceForm.className='admin-row';invoiceForm.style.marginTop='10px';
    const month=document.createElement('input');month.type='month';month.required=true;month.value=new Date().toISOString().slice(0,7);month.setAttribute('aria-label','Invoice month');
    const amount=document.createElement('input');amount.type='number';amount.min='0.01';amount.step='0.01';amount.required=true;amount.value='10000';amount.style.maxWidth='150px';amount.setAttribute('aria-label','Monthly base fee');
    const currency=document.createElement('select');currency.setAttribute('aria-label','Invoice currency');for(const cur of ['RWF','TRY']){const o=document.createElement('option');o.value=cur;o.textContent=cur;currency.append(o);}
    const submit=document.createElement('button');submit.type='submit';submit.className='btn btn-primary';submit.textContent='Create monthly invoice';invoiceForm.append(month,amount,currency,submit);
    invoiceForm.addEventListener('submit',async ev=>{ev.preventDefault();try{const period=month.value+'-01';const result=await api('create_monthly_invoice',{enrollment_id:en.id,period_start:period,currency:currency.value,base_amount:Number(amount.value)});msg(`Invoice created. Amount due: ${result.item.amount_due} ${result.item.currency}. Any approved monthly scholarship discount was applied.`, 'success');}catch(e){msg(e.message,'error');}});card.append(invoiceForm);
   }
   host.append(card);
  }
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
 async function loadReceipts(){try{msg('Loading payment receipts…');const b=await api('list_receipts');renderReceipts(b.items);msg(`Loaded ${b.items?.length||0} receipts.`,'success');}catch(e){msg(e.message,'error');}}
 
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

      const details = document.createElement('pre');
      details.style.whiteSpace = 'pre-wrap';
      details.style.overflowWrap = 'anywhere';
      details.textContent = JSON.stringify(item, null, 2);

      card.append(title, details);
      host.append(card);
    }

    msg(`Loaded ${items.length} scholarship requests.`, 'success');
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

      const details = document.createElement('pre');
      details.style.whiteSpace = 'pre-wrap';
      details.style.overflowWrap = 'anywhere';
      details.textContent = JSON.stringify(item, null, 2);

      card.append(title, details);
      host.append(card);
    }

    msg(`Loaded ${items.length} certificates.`, 'success');
  } catch (error) {
    msg(error.message || 'Could not load certificates.', 'error');
  }
}

 async function updateUI(){const {data}=await sb.auth.getSession();session=data.session;if(!session){$('loginCard').classList.remove('hidden');$('console').classList.add('hidden');return;} $('loginCard').classList.add('hidden');$('console').classList.remove('hidden');$('staffIdentity').textContent=`Signed in as ${session.user.email}`;try{const me=await api('whoami');currentRole=me.role;}catch(e){msg(e.message,'error');return;}const canApps=['administrator','coordinator'].includes(currentRole),canFinance=['administrator','finance_reviewer'].includes(currentRole),canEnroll=['administrator','coordinator','finance_reviewer'].includes(currentRole),canScholar=['administrator','coordinator'].includes(currentRole),canCert=['administrator','coordinator'].includes(currentRole);const hideCard=(id,hide)=>{$(id).closest('.admin-card').classList.toggle('hidden',hide);};hideCard('applications',!canApps);hideCard('receipts',!canFinance);hideCard('enrollments',!canEnroll);hideCard('scholarships',!canScholar);hideCard('certificates',!canCert);$('refreshApps').classList.toggle('hidden',!canApps);$('refreshReceipts').classList.toggle('hidden',!canFinance);$('refreshEnrollments').classList.toggle('hidden',!canEnroll);$('refreshScholarships').classList.toggle('hidden',!canScholar);$('refreshCertificates').classList.toggle('hidden',!canCert);if(!canApps&&!canFinance&&!canEnroll&&!canScholar&&!canCert){msg('Your staff role does not have a console workflow assigned yet.','error');return;}const jobs=[];if(canApps)jobs.push(loadApps());if(canFinance)jobs.push(loadReceipts());if(canEnroll)jobs.push(loadEnrollments());if(canScholar)jobs.push(loadScholarships());if(canCert)jobs.push(loadCertificates());await Promise.all(jobs);}
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{msg('Signing in…');const {error}=await sb.auth.signInWithPassword({email:String(fd.get('email')).trim(),password:String(fd.get('password'))});if(error)throw error;await updateUI();}catch(err){msg(err.message||'Sign-in failed.','error');}});
 $('refreshApps').addEventListener('click',loadApps);$('refreshReceipts').addEventListener('click',loadReceipts);$('refreshEnrollments').addEventListener('click',loadEnrollments);$('refreshScholarships').addEventListener('click',loadScholarships);$('refreshCertificates').addEventListener('click',loadCertificates);$('signOut').addEventListener('click',async()=>{await sb.auth.signOut();await updateUI();msg('Signed out.','success');});sb.auth.onAuthStateChange(()=>{setTimeout(updateUI,0);});updateUI();
})();
