/* SIFA public application client. All trust decisions are repeated by the Edge Function. */
(() => {
  const config = window.SIFA_SUPABASE_CONFIG || {};
  const form = document.getElementById('applicationForm');
  if (!form) return;
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '') && !!config.anonKey && !String(config.anonKey).includes('YOUR_SUPABASE');
  const notice = (message, type='error') => {
    let box = document.getElementById('studentAuthNotice');
    if (!box) { box = document.createElement('div'); box.id='studentAuthNotice'; box.setAttribute('role','status'); box.style.cssText='margin:0 0 24px;padding:16px 18px;border-radius:12px;border:1px solid #efcaca;background:#fff5f5;color:#8a2d2d;font-weight:600;'; form.parentElement.insertBefore(box, form); }
    box.textContent=message;
    const styles={error:['#fff5f5','#efcaca','#8a2d2d'],warning:['#fff9ed','#ecd59e','#70551a'],success:['#f1faf5','#bfe2cc','#1d6a3d']};
    const c=styles[type]||styles.error; box.style.background=c[0];box.style.borderColor=c[1];box.style.color=c[2];box.scrollIntoView({behavior:'smooth',block:'center'});
  };
  const field = name => { const el=form.elements.namedItem(name); return el && typeof el.value==='string' ? el.value.trim() : ''; };
  // Prefill only the new form, never modify submitted records or overwrite typed values.
  const touched = new Set();
  const personalFields = ['name','email','phone','country'];
  for(const name of personalFields){const input=form.elements.namedItem(name);input?.addEventListener('input',()=>touched.add(name));input?.addEventListener('change',()=>touched.add(name));}
  async function prefillProfile(){
    if(!ready||!window.supabase?.createClient)return;
    const status=document.getElementById('applicationProfileNotice');
    try{
      const client=(window.SIFAApplicationClient ||= window.supabase.createClient(config.url,config.anonKey,window.SIFA_AUTH_OPTIONS));
      const {data:sessionData,error:sessionError}=await client.auth.getSession();
      if(sessionError)throw sessionError;
      if(!sessionData.session)return;
      const {data:auth,error:authError}=await client.auth.getUser();
      if(authError||!auth.user)throw authError||new Error('Account unavailable');
      const user=auth.user;
      const {data:profile,error}=await client.from('profiles').select('full_name,phone,country').eq('id',user.id).maybeSingle();
      if(error)throw error;
      const {data:current}=await client.auth.getSession();
      if(current.session?.user?.id!==user.id)return;
      const values={name:profile?.full_name||user.user_metadata?.full_name,email:user.email,phone:profile?.phone,country:profile?.country};
      let filled=0;
      for(const name of personalFields){const input=form.elements.namedItem(name);let value=String(values[name]||'').trim();if(!input||!value||input.value||touched.has(name))continue;
        if(name==='country'){if(value.toLowerCase()==='turkey')value='Türkiye';const option=Array.from(input.options).find(o=>o.value.toLowerCase()===value.toLowerCase());if(!option)continue;value=option.value;}
        input.value=value;filled++;
      }
      if(status&&filled){status.textContent='Your saved SIFA account details have been filled in. Please review them and complete the remaining fields. You can edit these details before submitting.';status.hidden=false;}
    }catch(error){console.warn('Application profile autofill unavailable',error);if(status){status.textContent='Saved account details could not be loaded. You can still fill in the application manually.';status.hidden=false;}}
  }
  void prefillProfile();
  let submitting=false;
  function send(body,token,onProgress){return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',`${config.url}/functions/v1/public-application`);xhr.timeout=120000;
    xhr.setRequestHeader('apikey',config.anonKey);xhr.setRequestHeader('Authorization',`Bearer ${token}`);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>{let result={};try{result=JSON.parse(xhr.responseText);}catch{}resolve({ok:xhr.status>=200&&xhr.status<300,result});};
    xhr.onerror=xhr.ontimeout=()=>reject(new Error('We could not confirm your submission. Check My Application before trying again. Your form is still available.'));
    xhr.send(body);
  });}
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (window.SIFA_SETTINGS?.applicationsOpen !== true) { notice('Applications are currently closed. Your information has not been submitted. Please check the SIFA website for the next admissions announcement.','warning'); return; }
    if (!ready) { notice('The application service is not configured. No information has been sent. Please contact sifaglobalinstitute12@gmail.com.'); return; }
    if (submitting || !window.SIFAApplicationReady || !window.SIFAValidateApplication?.()) return;
    if (field('course') === 'QuickBooks Practical Training' && !((window.SIFA_SETTINGS?.openPrograms)||[]).includes(field('course'))) { notice('This program is not currently open for applications.'); return; }
    const submitBtn=document.getElementById('submitBtn');
    const oldText=submitBtn?.textContent;
    if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Submitting securely…';}
    submitting=true;
    try {
      if (!window.supabase?.createClient) throw new Error('Sign-in service unavailable. Please refresh.');
      const client=(window.SIFAApplicationClient ||= window.supabase.createClient(config.url,config.anonKey,window.SIFA_AUTH_OPTIONS));
      const {data:auth,error:authError}=await client.auth.getUser();
      if(authError || !auth.user?.email || !auth.user.email_confirmed_at) throw new Error('Please sign in to your verified SIFA account through the Student Portal before applying.');
      const {data:sessionData,error:sessionError}=await client.auth.getSession();
      const session=sessionData?.session;
      if(sessionError || !session?.access_token || session.user.id!==auth.user.id) throw new Error('Your session has expired. Please sign in again.');
      if(field('email').toLowerCase()!==auth.user.email.toLowerCase()) throw new Error('Please use the verified email address of your SIFA account.');
      const values={};
      new FormData(form).forEach((value,key)=>{ if(value instanceof File || ['_subject','name','email','phone','country','course','accuracy','contactConsent','website'].includes(key)) return; values[key]=String(value).trim(); });
      const files=[];let totalFileBytes=0;
      for (const input of Array.from(form.querySelectorAll('input[type="file"]'))) {
        for (const file of Array.from(input.files||[])) {
          if(!file || !file.size) continue;
          if(file.size>5*1024*1024) throw new Error(`${file.name} is larger than 5 MB. Please choose a smaller file.`);
          totalFileBytes+=file.size;if(totalFileBytes>8*1024*1024) throw new Error('All attachments together must be 8 MB or smaller.');
          files.push({file,field:input.name});
        }
      }
      if(files.length>12) throw new Error('Please attach no more than 12 files.');
      const body={full_name:field('name'),email:field('email'),phone:field('phone'),country:field('country'),program:field('course'),contact_consent:form.elements.namedItem('contactConsent')?.checked===true,accuracy_confirmed:form.elements.namedItem('accuracy')?.checked===true,payload:values,website:field('website')};
      const multipart=new FormData();multipart.append('application',JSON.stringify(body));for(const {file,field} of files)multipart.append(field,file,file.name);
      notice('Uploading your application and documents. Please keep this page open.','success');
      const {ok,result}=await send(multipart,session.access_token,p=>{if(submitBtn)submitBtn.textContent=p<100?`Uploading… ${p}%`:'Verifying and saving…';});
      if(!ok||!result.ok||!result.application_ref) throw new Error(result.error||'Submission could not be confirmed. Check My Application before retrying.');
      document.getElementById('studentAuthNotice')?.remove();
      form.style.display='none';
      const card=document.createElement('section'); card.className='application-success-card'; card.setAttribute('aria-live','polite');
      const safeRef=document.createElement('strong'); safeRef.textContent=result.application_ref||'Submitted';
      card.innerHTML='<div class="success-icon" aria-hidden="true">✓</div><span class="eyebrow success-eyebrow">Application received</span><h2>Application submitted successfully</h2><p>Thank you for applying to SIFA Global Institute. Your application has been received for review. Submission does not guarantee admission or a scholarship.</p><div class="success-reference"><span>Application reference</span></div><p class="success-note">Your application is now read-only. You can view its details and status in My Application. To make corrections, withdraw an eligible application and apply again when admissions are open. Admitted applications may require staff review.</p><div class="success-actions"><a class="btn btn-primary" href="student-portal.html?view=application">View My Application</a><a class="btn btn-secondary success-secondary" href="courses.html">View Courses</a></div>';
      card.querySelector('.success-reference').appendChild(safeRef);
      const status=document.createElement('span');status.textContent='Submitted · Awaiting review';status.style.color='#19733f';card.querySelector('.success-reference').append(status);
      const shell=form.closest('.apply-shell');if(shell){shell.replaceChildren(card);}else{form.parentElement.insertBefore(card,form);}
      card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({behavior:'smooth',block:'center'});
    } catch(error) { console.error('SIFA application submission failed',error); notice(error?.message||'We could not submit your application. Please try again.'); }
    finally { submitting=false; if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText||'Submit Application';} }
  },true);
})();
