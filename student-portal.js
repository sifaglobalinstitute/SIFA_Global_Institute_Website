(function () {
  const config = window.SIFA_SUPABASE_CONFIG || {};
  const ready = config.url && config.anonKey && !String(config.url).includes('YOUR_SUPABASE');
  const $ = (id) => document.getElementById(id);
  const loginPanel = $('loginPanel'), signupPanel = $('signupPanel'), dashboard = $('studentDashboard');
  const message = $('portalMessage');
  const loginMessage = $('loginMessage');
  const signupMessage = $('signupMessage');
  let supabase = null;
  let currentUser = null;
  let savedProfile = null, profileReady = false, profileSaving = false, profileLoadVersion = 0;
  let bootComplete = false;
  let pendingConfirm = null;
  let recoveryLinkError = null;

  // Supabase may return recovery errors in the URL fragment. Read only the
  // non-secret error fields, then remove the fragment so stale auth data is
  // not left in the address bar or browser history.
  try {
    const authHash = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const authErrorCode = authHash.get('error_code');
    const authError = authHash.get('error');
    if (authErrorCode || authError) {
      if (authErrorCode === 'otp_expired') {
        recoveryLinkError = 'This password-reset link has expired or has already been used. Return to sign in and request a new link.';
      } else {
        recoveryLinkError = 'This password-reset link could not be verified or is no longer valid. Return to sign in and request a new link.';
      }
      history.replaceState({}, document.title, location.pathname + location.search);
    }
  } catch (_) {
    // Keep the portal usable if URL parsing is unavailable.
  }

  
function showMessage(text, type = 'info') {
  const activePanel = !loginPanel.hidden
    ? loginPanel
    : !signupPanel.hidden
      ? signupPanel
      : null;

  
const target = activePanel === loginPanel && loginMessage
  ? loginMessage
  : activePanel === signupPanel && signupMessage
    ? signupMessage
    : message;

  if (!target) return;

  target.textContent = text;
  target.className = 'portal-message ' + type;
  target.setAttribute(
    'role',
    type === 'error' ? 'alert' : 'status'
  );
  target.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  target.hidden = false;

  target.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}

  function hideMessage(){ if(message) message.hidden = true; if(loginMessage) loginMessage.hidden = true; if(signupMessage) signupMessage.hidden = true; }
  function showLogin(messageText, type='info') {
    loginPanel.hidden=false; signupPanel.hidden=true; dashboard.hidden=true;
    window.SIFAClearPhoto?.(); aidRecords=[]; dashboard.removeAttribute("data-staff"); $("sifaStaffWorkspace").hidden=true; currentUser=null; savedProfile=null; profileReady=false; profileLoadVersion++;
    for(const id of ["profileName","profilePhone","profileCountry"]) if($(id)) $(id).value="";
    if($("profileSaveMessage")) $("profileSaveMessage").hidden=true; syncProfileControls();
    if (messageText) showMessage(messageText, type); else hideMessage();
  }
  function showSignup(){ loginPanel.hidden=true; signupPanel.hidden=false; dashboard.hidden=true; hideMessage(); }
  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  }
  let aidRecords = [];
  let admissionAvailable = false;
  let admissionPrograms = [];
  function getOpenPrograms() { return admissionPrograms; }
  function latestApplication(applications) { return applications?.[0] || null; }
  function activeApplicationStatus(status) { return ['Submitted','Under Review','Needs Information','Accepted'].includes(status); }

  function renderApplication(app, allApplications) {
    const payload = app?.payload || {};
    const status = app?.status || 'Not started';
    const withdrawn = app?.status === 'Withdrawn';
    const ref = app?.application_ref || '—';
    $('applicationStatus').textContent = status === 'Accepted' ? 'Admitted' : status;
    $('applicationRef').textContent = ref;
    $('currentApplicationId').value = app?.id || '';
    $('quickbooksStatus').textContent = status;
    const empty = $('applicationEmpty');
    $('my-application').dataset.empty = String(!app);
    if (app) {
      empty.hidden = true;
      $('applicationNote').textContent = withdrawn
        ? 'This application has been withdrawn. Other applications may still be active.'
        : 'Your submitted applications are read-only. Expand a record to review your submitted information and track your admission status.';
    } else {
      empty.hidden = false;
      $('applicationNote').textContent = admissionAvailable ? 'You have not submitted an application. Check the available programs.' : 'You have not submitted an application. Admissions are currently closed or unavailable.';
    }


    const history = $('applicationHistory');
    history.innerHTML = '';
    if (allApplications && allApplications.length > 0) {

      allApplications.forEach(item => {
        const row = document.createElement('article'); row.className='sifa-app-record';
        const refText = document.createElement('span'); refText.className='sifa-app-ref';refText.textContent=item.application_ref || 'Application';
        const header=document.createElement('div');header.className='sifa-app-header';const title=document.createElement('h4');title.textContent=item.payload?.course||'Program';const state=document.createElement('span');state.className='sifa-app-status';state.dataset.status=item.status||'';state.textContent=item.status==='Accepted'?'Admitted':item.status||'Submitted';header.append(title,state);
        const meta=document.createElement('span'); meta.style='color:#62748a;font-size:13px'; meta.textContent=`Submitted ${formatDate(item.submitted_at)}${item.payload?.mode?' · '+item.payload.mode:''}`;
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'View submitted information'; details.append(summary);
        const grid = document.createElement('div'); grid.className = 'application-grid';
        const fields = {name:'Full name',email:'Email',phone:'Phone',country:'Country',city:'City',nationality:'Nationality',course:'Program',mode:'Learning mode',cohort:'Cohort',schedule:'Schedule',language:'Language',education:'Education',background:'Background',status:'Occupation',occupationOther:'Other occupation',kinyarwanda:'Speaks Kinyarwanda',softwareExperience:'Software experience',goals:'Learning goals',financialSupport:'Financial support',financialCircumstances:'Financial circumstances',scholarshipReason:'Scholarship reason',scholarshipValue:'Requested scholarship',documentStatus:'Document status',documentIssue:'Document issue'};
        const values = {...(item.payload||{}),name:item.full_name || item.payload?.name,email:item.email || item.payload?.email,phone:item.phone || item.payload?.phone,country:item.country || item.payload?.country};
        for (const [key,label] of Object.entries(fields)) {
          if (values[key] == null || values[key] === '') continue;
          const cell=document.createElement('div'); cell.className='application-item';
          const caption=document.createElement('span'); caption.textContent=label;
          const value=document.createElement('strong'); value.style.overflowWrap='anywhere'; value.textContent=String(values[key]); cell.append(caption,value); grid.append(cell);
        }
        details.append(grid); row.append(header,refText,meta,details);
        for(const award of aidRecords.filter(x=>x.application_id===item.id && x.source===(item.source||'legacy'))){const panel=document.createElement('div');panel.style.cssText='padding:12px;background:#f1f6f4;border-radius:10px';const h=document.createElement('strong');h.textContent='Scholarship / fee waiver — '+award.decision;const note=document.createElement('p');note.textContent=award.decision==='approved'?`${award.monthly_discount_percent}% monthly tuition discount · ${award.starts_on||'No start date'} to ${award.ends_on||'No end date'}`:'Your financial support decision is recorded separately from admission.';panel.append(h,note);row.append(panel);}
        if (['Submitted','Under Review','Needs Information'].includes(item.status)) {
          const button=document.createElement('button'); button.type='button'; button.className='btn danger-btn'; button.textContent='Withdraw application'; button.addEventListener('click',()=>requestWithdrawal(item.id,item.source || 'legacy',button)); const action=document.createElement('div');action.className='sifa-app-actions';const hint=document.createElement('p');hint.textContent='Need to correct your information? Withdraw this application and reapply when admissions are open. Your original submission stays in your history.';action.append(hint,button);row.append(action);
        } else if(item.status==='Accepted'){const hint=document.createElement('p');hint.className='sifa-app-help';hint.textContent='For changes or withdrawal after admission, contact SIFA support.';row.append(hint);}
        history.appendChild(row);
      });
    }

    const open = admissionAvailable && getOpenPrograms().includes('QuickBooks Practical Training');
    if (!app) empty.textContent = open ? 'No application has been submitted. You can apply for QuickBooks Practical Training.' : 'No application has been submitted. Admissions are currently closed or unavailable.';
    const hasActiveApplication = (allApplications || []).some(item => activeApplicationStatus(item.status) && item.payload?.course === 'QuickBooks Practical Training');
    const visibleApply = $('sifaApplyLink');
    if (visibleApply) {
      visibleApply.textContent = open && !hasActiveApplication ? 'Start Application' : 'Explore Programs';
      visibleApply.href = open && !hasActiveApplication ? 'apply.html' : 'courses.html';
    }
    const btn = $('applyPortalBtn');
    btn.classList.remove('btn-disabled');btn.removeAttribute('aria-disabled');
    const badge=document.querySelector('.quickbooks-card .course-badge');if(badge){badge.textContent=open?'ADMISSIONS OPEN':'ADMISSIONS CLOSED';badge.classList.toggle('closed-badge',!open);}
    if (hasActiveApplication) {
      btn.textContent = 'View My Application'; btn.href='#my-application'; btn.onclick=(e)=>{e.preventDefault(); $('sifaOpenApplication')?.click();};
    } else {
      btn.textContent = open ? 'Apply for QuickBooks' : 'Applications Closed';
      btn.href = open ? 'apply.html?program=QuickBooks%20Practical%20Training' : 'apply.html';
      btn.onclick = null;
      btn.classList.toggle('btn-disabled', !open);
      if (!open) { btn.setAttribute('aria-disabled','true'); btn.onclick=(e)=>e.preventDefault(); }
    }
  }

  function renderProfile(user, profile) {
    const name = profile?.full_name || user.user_metadata?.full_name || 'Student';
    $('studentName').textContent=name;
    $('accountProfileName').textContent=name;
    $('accountProfileInitials').textContent=name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toUpperCase(); $('studentEmail').textContent=user.email || '';
    $('accountEmail').textContent=user.email || '—'; $('accountStatus').textContent='Active';
    $('emailStatus').textContent=user.email_confirmed_at ? 'Confirmed' : 'Not confirmed';
    $('memberSince').textContent=formatDate(user.created_at);
    if (profileReady && !profileSaving && !profileDirty()) fillProfileFields(savedProfile);
  }

  function profileValues(){return {full_name:$('profileName').value.trim(),phone:$('profilePhone').value.trim(),country:$('profileCountry').value.trim()};}
  function profileDirty(){return !!savedProfile && Object.keys(profileValues()).some(k=>profileValues()[k]!==savedProfile[k]);}
  function fillProfileFields(p){
    if(!p)return;
    $('profileName').value=p.full_name; $('profilePhone').value=p.phone;
    const select=$('profileCountry');
    if(p.country && !Array.from(select.options).some(o=>o.value===p.country)) select.add(new Option(p.country,p.country));
    select.value=p.country;
  }
  function profileNotice(text,type='info'){
    const box=$('profileSaveMessage'); box.textContent=text; box.className='portal-message '+type; box.hidden=!text;
    box.setAttribute('role',type==='error'?'alert':'status');
  }
  function syncProfileControls(){
    const editable=profileReady&&!profileSaving;
    for(const id of ['profileName','profilePhone','profileCountry']) if($(id)) $(id).disabled=!editable;
    $('saveProfileBtn').disabled=!editable||!profileDirty(); $('resetProfileBtn').disabled=!editable||!profileDirty();
    $('retryProfileBtn').hidden=profileReady||profileSaving;
  }
  function acceptProfile(user,profile){
    savedProfile={full_name:profile?.full_name||user.user_metadata?.full_name||'',phone:profile?.phone||'',country:profile?.country||''};
    profileReady=true; fillProfileFields(savedProfile); syncProfileControls();
  }
  // Registration may require email confirmation before an authenticated session exists.
  // Create a missing profile on authenticated entry, without overwriting existing edits.
  async function ensureStudentProfile(user, existing){
    if(existing) return existing;
    const name=String(user.user_metadata?.full_name||'').trim();
    if(!name) return null;
    const {error}=await supabase.from('profiles').upsert({id:user.id,full_name:name,email:user.email||''},{onConflict:'id',ignoreDuplicates:true});
    if(error) throw error;
    const {data,error:readError}=await supabase.from('profiles').select('full_name,phone,country').eq('id',user.id).single();
    if(readError) throw readError;
    return data;
  }
  async function reloadProfile(){
    const user=currentUser; if(!user||profileSaving)return;
    const version=++profileLoadVersion; profileReady=false; syncProfileControls(); profileNotice('Loading your saved details…');
    try{
      const {data,error}=await supabase.from('profiles').select('full_name,phone,country').eq('id',user.id).maybeSingle();
      if(error)throw error;
      if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
      const resolved=await ensureStudentProfile(user,data);
      if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
      acceptProfile(user,resolved); renderProfile(user,resolved); profileNotice('');
    }catch(error){if(currentUser?.id!==user.id||version!==profileLoadVersion)return; console.error('Profile load failed',error); profileNotice('We could not load your saved details. Reload them before editing to avoid overwriting existing information.','error');syncProfileControls();}

  }

  function showDashboard(user, profile, applications) {
    loginPanel.hidden=true; signupPanel.hidden=true; dashboard.hidden=false;
    renderProfile(user, profile); renderApplication(latestApplication(applications), applications || []);
  }


  function formatEnrollmentDate(value) {
    if (!value) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const d = new Date(value + 'T00:00:00Z');
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, {year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
    }
    return formatDate(value);
  }

  // Display enrollment records from the protected student billing API.
  // Never infer classroom authorization solely from enrollment status.
  async function loadEnrollments(userId) {
    const section = $('sifaEnrollmentSection');
    const status = $('sifaEnrollmentStatus');
    const host = $('sifaEnrollmentItems');
    if (!section || !status || !host) return;

    status.hidden = false;
    status.className = 'sifa-state';
    status.textContent = 'Loading your enrollments…';
    host.replaceChildren();

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session?.access_token || data.session.user.id !== userId) {
        throw new Error('Please sign in again to view your enrollments.');
      }
      const response = await fetch(`${config.url}/functions/v1/sifa-student-billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.anonKey,
          'Authorization': `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({ action: 'list_invoices' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to load enrollments.');
      // Do not expose an older account's response if the user switched accounts.
      if (currentUser?.id !== userId) return;
      const enrollments = Array.isArray(result.enrollments) ? result.enrollments : [];
      if (!enrollments.length) {
        status.textContent = 'You do not have an enrollment yet. Explore SIFA programs to plan your next step.';
        return;
      }
      status.hidden = true;
      const labels = {
        pending_payment: 'Pending payment',
        active: 'Active enrollment',
        suspended: 'Suspended',
        completed: 'Completed',
        cancelled: 'Cancelled'
      };
      for (const enrollment of enrollments) {
        const item = document.createElement('details');
        item.className = 'sifa-enrollment-item';
        const summary = document.createElement('summary');
        summary.className = 'sifa-enrollment-summary';
        const mark = document.createElement('span');
        mark.className = 'sifa-enrollment-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '▤';
        const heading = document.createElement('span');
        heading.className = 'sifa-enrollment-name';
        heading.textContent = enrollment.program || 'SIFA program';
        const badge = document.createElement('span');
        badge.className = 'sifa-enrollment-badge';
        badge.dataset.state = String(enrollment.status || '');
        badge.textContent = labels[enrollment.status] || enrollment.status || 'Status unavailable';
        const chevron = document.createElement('span');
        chevron.className = 'sifa-enrollment-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(mark, heading, badge, chevron);
        item.append(summary);
        const body = document.createElement('div');
        body.className = 'sifa-enrollment-body';
        const fields = document.createElement('div');
        fields.className = 'sifa-enrollment-fields';
        for (const [label, value] of [
          ['Enrollment status', labels[enrollment.status] || enrollment.status || '—'],
          ['Start date', formatEnrollmentDate(enrollment.start_date)],
          ['End date', formatEnrollmentDate(enrollment.end_date)]
        ]) {
          const field = document.createElement('div');
          field.className = 'sifa-enrollment-field';
          const key = document.createElement('span');
          key.textContent = label;
          const val = document.createElement('strong');
          val.textContent = String(value);
          field.append(key, val);
          fields.append(field);
        }
        body.append(fields);
        const note = document.createElement('p');
        note.className = 'sifa-enrollment-note';
        note.textContent = 'Classroom access is checked separately against current fees, enrollment dates, and approved exceptions.';
        body.append(note);
        item.append(body);
        host.append(item);
      }
    } catch (error) {
      if (currentUser?.id !== userId) return;
      console.error('Enrollment loading failed:', error);
      status.hidden = false;
      status.className = 'sifa-state error';
      status.textContent = 'Your enrollment status could not be loaded. Please refresh or contact SIFA support.';
    }
  }

  async function checkStaffRole() {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session?.access_token) {
        throw new Error('Session unavailable');
      }

      const response = await fetch(
        `${config.url}/functions/v1/sifa-admin-api`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.session.access_token}`,
            'apikey': config.anonKey
          },
          body: JSON.stringify({ action: 'whoami' }),signal:AbortSignal.timeout(15000)
        }
      );

      // Ordinary students do not have a staff role.
      if (response.status === 403) {
        return null;
      }

      if (!response.ok) {
        throw new Error('Account role could not be verified.');
      }

      const result = await response.json();

      if (
        result.active === true &&
        ['administrator', 'coordinator', 'finance_reviewer','instructor'].includes(result.role)
      ) {
        return result;
      }

      return null;
    } catch (error) {
      console.warn('SIFA staff-role check failed:', error);
      throw error;
    }
  }

  async function loadUser(user, noticeText) {
    if (!user) return showLogin();
    const changed=currentUser?.id!==user.id;
    if(changed){savedProfile=null;profileReady=false;profileSaving=false;fillProfileFields({full_name:'',phone:'',country:''});syncProfileControls();}
    currentUser=user;
    const version=++profileLoadVersion;
    dashboard.hidden=true; window.SIFAClearPhoto?.(); aidRecords=[];
    dashboard.removeAttribute('data-staff'); $('sifaStaffWorkspace').hidden=true;
    let staffRole;
    try{staffRole=await checkStaffRole();}catch(e){if(currentUser?.id===user.id&&version===profileLoadVersion){loginPanel.hidden=true;signupPanel.hidden=true;showMessage('We could not verify your account type. Refresh this page to try again.','error');}return;}
    if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
    if(staffRole){
      dashboard.dataset.staff='true';loginPanel.hidden=true;signupPanel.hidden=true;dashboard.hidden=false;
      $('sifaStaffWorkspace').hidden=false;$('sifaStaffName').textContent='Welcome, '+(staffRole.full_name||user.user_metadata?.full_name||'Staff member');
      $('sifaStaffRole').textContent=staffRole.role.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
      const slot=$('sifaStaffConsoleSlot');slot.replaceChildren();const link=document.createElement('a');link.className='sifa-staff-green';link.href='sifa-admin.html';link.textContent='Open Staff Console';slot.append(link);
      $('sifaStaffWorkspace').querySelector('a[href="sifa-classroom-manager.html"]').closest('section').hidden=!['administrator','coordinator','instructor'].includes(staffRole.role);
      if(noticeText)showMessage(noticeText,'success');else hideMessage();return;
    }
    admissionAvailable=false; admissionPrograms=[];
    const admission = await supabase.from('admission_settings').select('applications_open,open_programs').eq('id',true).single();
    if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
    if(!admission.error){admissionAvailable=admission.data?.applications_open===true; admissionPrograms=Array.isArray(admission.data?.open_programs)?admission.data.open_programs:[];}
    let [{data:profile,error:profileError},{data:applications,error:appError},{data:publicApplications,error:publicAppError}]=await Promise.all([
      supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(),
      supabase.from('applications').select('id,application_ref,status,submitted_at,updated_at,payload,created_at,full_name,email').eq('user_id',user.id).order('created_at',{ascending:false}),
      supabase.from('sifa_public_applications').select('id,application_ref,status,submitted_at,updated_at,payload,full_name,email,phone,country,program').eq('linked_user_id',user.id).order('submitted_at',{ascending:false})
    ]);
    if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
    if(!profileSaving && !profileDirty()){
      if(!profileError && !profile){try{profile=await ensureStudentProfile(user,profile);}catch(error){profileError=error;}}
      if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
      if(profileError){profileReady=false;console.error('Profile load failed',profileError);profileNotice('We could not load your saved details. Reload them before editing.','error');syncProfileControls();}
      else {acceptProfile(user,profile);profileNotice('');}
    }
    if(appError) console.error('Application load error:',appError);
    if(publicAppError) console.warn('Public application load skipped (backend migration may not yet be deployed):',publicAppError.message);
    const mappedPublic=(publicApplications||[]).map(a=>({...a,source:'public',created_at:a.submitted_at,payload:{...(a.payload||{}),course:a.program,phone:a.phone,country:a.country}}));
    const merged=[...(applications||[]),...mappedPublic].sort((a,b)=>new Date(b.created_at||b.submitted_at||0)-new Date(a.created_at||a.submitted_at||0));
    
    let aidUnavailable=false;let announcements=[];
    try{const {data:auth}=await supabase.auth.getSession();if(auth.session?.user.id!==user.id)return;const r=await fetch(`${config.url}/functions/v1/sifa-student-billing`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.anonKey,Authorization:'Bearer '+auth.session.access_token},body:JSON.stringify({action:'student_support'}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Support unavailable');const support=await r.json();if(currentUser?.id!==user.id||version!==profileLoadVersion)return;aidRecords=support.awards||[];announcements=support.announcements||[];}catch{aidUnavailable=true;}
    if(currentUser?.id!==user.id||version!==profileLoadVersion)return;
    showDashboard(user, profile || {}, merged);
    const old=$('sifaSupportNotices');old?.remove();const notices=document.createElement('section');notices.id='sifaSupportNotices';notices.className='sifa-app-record';
    if(aidUnavailable){notices.textContent='Scholarship and announcement records could not be loaded. Refresh to try again.';$('applicationHistory').before(notices);}
    else if(announcements.length){notices.style.gridColumn='1 / -1';const h=document.createElement('h3');h.textContent='Private admission announcements';notices.append(h);for(const a of announcements){const d=document.createElement('article');const t=document.createElement('strong');t.textContent=a.title+' · '+a.program;const m=document.createElement('p');m.textContent=a.description;d.append(t,m);notices.append(d);} $('sifaDashboardExtras').prepend(notices);}

    void window.SIFALoadPhoto?.(supabase,window.SIFA_SUPABASE_CONFIG,user.id);
    if(appError || publicAppError) { $('applicationNote').textContent='Some application records could not be loaded. Please refresh before applying again.'; $('applicationEmpty').textContent='Application records could not be fully loaded.'; $('sifaApplyLink').textContent='Explore Programs'; $('sifaApplyLink').href='courses.html'; }
    if (new URLSearchParams(location.search).get('view')==='application') $('sifaOpenApplication')?.click();
    void loadEnrollments(user.id);

    if(noticeText) showMessage(noticeText,'success');
    const params = new URLSearchParams(location.search);
    if(params.get('submitted')==='1') {
      history.replaceState({},'', 'student-portal.html');
      showMessage('Application submitted successfully. Your reference number and submitted information are shown in My Application.','success');
    }
  }

  function openModal({title, body, requireText=false, confirmLabel='Confirm', danger=false, onConfirm}) {
    const modal=$('actionModal');
    $('actionModalTitle').textContent=title;
    $('actionModalBody').textContent=body;
    $('actionModalConfirm').textContent=confirmLabel;
    $('actionModalConfirm').classList.toggle('danger-btn', danger);
    $('actionModalInputWrap').hidden=!requireText;
    $('actionModalInput').value='';
    modal.hidden=false;
    pendingConfirm=onConfirm;
    if(requireText) setTimeout(()=>$('actionModalInput').focus(),50); else setTimeout(()=>$('actionModalCancel').focus(),50);
  }
  function closeModal(){ const modal=$('actionModal'); if(modal) modal.hidden=true; pendingConfirm=null; }

  function openPasswordPanel(recovery=false) {
    const panel=$('passwordChangePanel');
    if(!panel) return;
    panel.hidden=false;
    panel.dataset.recovery=recovery?'true':'false';
    $('newPassword').value=''; $('confirmNewPassword').value='';
    $('passwordPanelTitle').textContent=recovery?'Set a new password':'Change your password';
    $('passwordPanelText').textContent=recovery?'Choose a new password for your SIFA account.':'Enter and confirm your new password below.';
    panel.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>$('newPassword').focus(),200);
  }
  function closePasswordPanel(){ if($('passwordChangePanel')) $('passwordChangePanel').hidden=true; }

  if (!ready) { showLogin('Student Portal setup is not connected yet. Please complete the Supabase configuration first.','warning'); return; }
  if (!window.supabase?.createClient) { showLogin('The secure Student Portal library could not be loaded. Please refresh the page.','error'); return; }
  
supabase = window.supabase.createClient(
  config.url,
  config.anonKey,
  window.SIFA_AUTH_OPTIONS
);


  $('showSignup')?.addEventListener('click',e=>{e.preventDefault();showSignup();});
  $('showLogin')?.addEventListener('click',e=>{e.preventDefault();showLogin();});
  $('forgotPassword')?.addEventListener('click',async e=>{
    e.preventDefault();
    const email=$('loginEmail').value.trim();
    if(!email)return showMessage('Enter your email address first.','error');
    const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(error)return showMessage(error.message,'error');
    
showMessage(
  'If an account exists for this email address, password-reset instructions will be sent. Please check your inbox and spam folder.',
  'success'
);
});

  $('loginForm')?.addEventListener('submit',async e=>{
    e.preventDefault();hideMessage();
    const email=$('loginEmail').value.trim(), password=$('loginPassword').value;
    const{data,error}=await supabase.auth.signInWithPassword({email,password});
   
if (error) {
  console.error('Student sign-in failed:', error);
  return showMessage(
    'Unable to sign in. The email address or password is incorrect. Please check your details and try again.',
    'error'
  );
}

    await loadUser(data.user);
  });
  $('signupForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  hideMessage();

  const name = $('signupName').value.trim();
  const email = $('signupEmail').value.trim();
  const password = $('signupPassword').value;
  const confirm = $('signupConfirm').value;

  if (name.length < 2) {
    return showMessage('Please enter your full name.', 'error');
  }

  if (password.length < 8) {
    return showMessage('Your password must contain at least 8 characters.', 'error');
  }

  if (password !== confirm) {
    return showMessage('The two passwords do not match.', 'error');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${location.origin}/student-portal.html?confirmed=true${new URLSearchParams(location.search).get('view')==='application'?'&view=application':''}`
    }
  });

  
if (error) {
  console.error('SIFA account registration failed:', error);
  return showMessage(
    'We could not create your account. Please check your details and try again. If the problem continues, contact SIFA support.',
    'error'
  );
}

    if (!data.session) {
      showSignup();
      showMessage(
        'Account request received! Please check your inbox for the SIFA verification email. Open the link to activate your account.',
        'success'
      );
    } else {
      await loadUser(data.user);
      showMessage(
        'Welcome to SIFA Global Institute! Your account has been created successfully.',
        'success'
      );
    }
    
});
  $('profileForm')?.addEventListener('input',()=>{if(!profileSaving){profileNotice(profileDirty()?'You have unsaved changes.':'');syncProfileControls();}});
  $('resetProfileBtn')?.addEventListener('click',()=>{fillProfileFields(savedProfile);profileNotice('Unsaved changes discarded.');syncProfileControls();});
  $('retryProfileBtn')?.addEventListener('click',reloadProfile);
  $('profileForm')?.addEventListener('submit',async e=>{
    e.preventDefault(); if(!currentUser||!profileReady||profileSaving||!profileDirty())return;
    const user=currentUser, values=profileValues(), btn=$('saveProfileBtn');
    if(values.full_name.length<2)return profileNotice('Please enter your full name.','error');
    profileSaving=true; ++profileLoadVersion; syncProfileControls(); btn.textContent='Saving…';profileNotice('Saving your details securely…');
    try{
      const {error}=await supabase.from('profiles').upsert({id:user.id,email:user.email||'',...values,updated_at:new Date().toISOString()});
      if(error)throw error;
      const {data,error:readError}=await supabase.from('profiles').select('full_name,phone,country').eq('id',user.id).single();
      if(readError)throw readError;
      if(!data||Object.keys(values).some(k=>String(data[k]??'')!==values[k]))throw new Error('Saved profile verification mismatch');
      if(currentUser?.id!==user.id)return;
      acceptProfile(user,data);renderProfile(user,data);profileNotice('Your details have been saved and verified. They will be available for future applications.','success');
    }catch(error){console.error('Profile save or verification failed',error);if(currentUser?.id===user.id)profileNotice('We could not confirm that your changes were saved. Your edits are still here. Please try again.','error');}
    finally{if(currentUser?.id===user.id){profileSaving=false;btn.textContent='Save Changes';syncProfileControls();}}
  });

  $('emailChangeForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentUser) return showMessage('Please sign in again before changing your email address.', 'error');
    const nextEmail = $('newEmail').value.trim();
    const target = $('emailChangeMessage');
    const btn = $('requestEmailChangeBtn');
    if (!nextEmail) return;
    if (nextEmail.toLowerCase() === String(currentUser.email || '').toLowerCase()) {
      if (target) { target.textContent = 'This is already your current login email address.'; target.className = 'portal-message warning'; target.hidden = false; }
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending confirmation…';
    if (target) target.hidden = true;
    try {
      const { error } = await supabase.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: `${location.origin}${location.pathname}` }
      );
      if (error) {
        if (target) { target.textContent = error.message || 'We could not start the email-change process. Please try again.'; target.className = 'portal-message error'; target.hidden = false; }
        return;
      }
      if (target) {
        target.textContent = 'Confirmation instructions have been requested. Please check the relevant inboxes and complete Supabase’s confirmation process. Your login email will remain unchanged until confirmation is complete.';
        target.className = 'portal-message success';
        target.hidden = false;
      }
      $('newEmail').value = '';
    } catch (error) {
      console.error('Email change request failed:', error);
      if (target) { target.textContent = 'We could not request the email change right now. Please try again or contact SIFA support.'; target.className = 'portal-message error'; target.hidden = false; }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Request Email Change';
    }
  });

  $('resetPasswordBtn')?.addEventListener('click',()=>openPasswordPanel(false));
  $('cancelPasswordBtn')?.addEventListener('click',closePasswordPanel);
  $('cancelPasswordBtn2')?.addEventListener('click',closePasswordPanel);
  $('passwordForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const p=$('newPassword').value, c=$('confirmNewPassword').value;
    if(p.length<8)return showMessage('Your new password must contain at least 8 characters.','error');
    if(p!==c)return showMessage('The new passwords do not match.','error');
    const btn=$('savePasswordBtn');btn.disabled=true;btn.textContent='Updating…';
    const{error}=await supabase.auth.updateUser({password:p});
    btn.disabled=false;btn.textContent='Update Password';
    if(error)return showMessage(error.message,'error');
    closePasswordPanel();
$('sifaCloseAccount')?.click();
showMessage('Your password has been changed successfully.','success');
  });

  function requestWithdrawal(id,source,button){
    if(!currentUser || !id)return;
    const owner=currentUser.id;
    openModal({title:'Withdraw your application?',body:'Your application remains in your history. You may apply again when admissions are open. Pending scholarship requests will also be withdrawn. Admitted applications, approved awards or linked enrollments require staff review.',confirmLabel:'Withdraw Application',danger:true,onConfirm:async()=>{
      if(currentUser?.id!==owner)return closeModal();
      button.disabled=true;
      try {
        const {error}=await supabase.rpc('sifa_withdraw_my_application',{p_application_id:id,p_source:source});
        closeModal();
        if(currentUser?.id!==owner)return;
        if(error)return showMessage('Withdrawal could not be completed. Refresh your application status or contact SIFA support.','error');
        await loadUser(currentUser,'Your application has been withdrawn successfully. You may reapply when admissions are open.'); $('sifaOpenApplication')?.click();
      } catch(error){closeModal();showMessage('Connection unavailable. Refresh to verify your application status.','error');}
      finally{button.disabled=false;}
    }});
  }

    $('deleteAccountBtn')?.addEventListener('click', () => {
    if (!currentUser) return;

    openModal({
      title: 'Delete your SIFA account?',
      body: 'This permanently deletes your SIFA student account and associated application data. This action cannot be undone.',
      requireText: true,
      confirmLabel: 'Delete My Account',
      danger: true,

      onConfirm: async () => {
        const btn = $('deleteAccountBtn');
        const input = $('actionModalInput');

        if (input.value.trim() !== 'DELETE') {
          return showMessage('Type DELETE exactly to confirm account deletion.', 'error');
        }

        btn.disabled = true;
        btn.textContent = 'Deleting…';

        try {
          // 1. Remove uploaded student documents through the Storage API.
          const { data: files, error: listError } = await supabase
            .storage
            .from('student-documents')
            .list(currentUser.id, { limit: 1000 });

          if (listError) throw listError;

          if (files?.length) {
            const paths = files.map(file => `${currentUser.id}/${file.name}`);

            const { error: removeError } = await supabase
              .storage
              .from('student-documents')
              .remove(paths);

            if (removeError) throw removeError;
          }

          // 2. Delete the student's account and database records.
          const { error } = await supabase.rpc('delete_my_account');

          if (error) throw error;

          closeModal();
          currentUser = null;

          await supabase.auth.signOut();

          showLogin(
            'Your SIFA student account has been permanently deleted.',
            'success'
          );

        } catch (error) {
          console.error('Delete account error:', error);

          btn.disabled = false;
          btn.textContent = 'Delete My Account';

          showMessage(
            error?.message ||
            'We could not delete your account yet. Please try again or contact SIFA support.',
            'error'
          );
        }
      }
    });
  });
  $('actionModalCancel')?.addEventListener('click',closeModal);
  $('actionModalCancel2')?.addEventListener('click',closeModal);
  $('actionModal')?.addEventListener('click',e=>{if(e.target.id==='actionModal')closeModal();});
  $('actionModalConfirm')?.addEventListener('click',()=>{if(pendingConfirm)pendingConfirm();});
  $('sifaStaffSignOut')?.addEventListener('click',()=> $('logoutBtn')?.click());
  $('logoutBtn')?.addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage('Could not log out. Please try again.', 'error');
    return;
  }

  currentUser = null;
  showLogin('You have been signed out.', 'success');
});

  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(async () => {
 if (event === 'PASSWORD_RECOVERY' && session?.user) {
    currentUser = session.user;

    setTimeout(async () => {
        await loadUser(session.user);
        $('sifaAccountGrid').hidden = false;
        openPasswordPanel(true);
    }, 0);

    return;
}

  if (!bootComplete) return;
  if (event === "TOKEN_REFRESHED" || (event === "SIGNED_IN" && currentUser?.id === session?.user?.id && !new URLSearchParams(location.search).has("confirmed"))) return;

  if (session?.user) {
    const justConfirmed =
  event === 'SIGNED_IN' &&
  new URLSearchParams(window.location.search).get('confirmed') === 'true';

    await loadUser(session.user);

    
if (justConfirmed) {
  showMessage(
    'Your email has been confirmed. Welcome to SIFA Global Institute! Your account is ready.',
    'success'
  );

  try {
    const { data: welcomeData, error: welcomeError } =
      await supabase.functions.invoke('sifa-welcome-email');

    if (welcomeError) {
      console.error('SIFA welcome email request failed:', welcomeError);
    } else {
      console.log('SIFA welcome email response:', welcomeData);
    }
  } catch (welcomeError) {
    console.error('SIFA welcome email request failed:', welcomeError);
  }

  history.replaceState({}, document.title, window.location.pathname + (new URLSearchParams(location.search).get('view')==='application'?'?view=application':''));
}

  } else {
    showLogin();
  }
    },0);
});

supabase.auth.getSession().then(({ data, error }) => {
  bootComplete = true;

  if (error) {
    console.error('Session check failed:', error);
    showLogin('Please sign in to continue.', 'info');
    return;
  }

  if (data.session?.user) {
    loadUser(data.session.user);
  } else if (recoveryLinkError) {
    showLogin(recoveryLinkError, 'error');
  } else {
    showLogin();
  }
});
})();
