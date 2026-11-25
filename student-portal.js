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
    if (messageText) showMessage(messageText, type); else hideMessage();
  }
  function showSignup(){ loginPanel.hidden=true; signupPanel.hidden=false; dashboard.hidden=true; hideMessage(); }
  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  }
  function getOpenPrograms() { return Array.isArray(window.SIFA_SETTINGS?.openPrograms) ? window.SIFA_SETTINGS.openPrograms : []; }
  function latestApplication(applications) { return applications?.[0] || null; }
  function activeApplicationStatus(status) { return ['Submitted','Under Review','Needs Information','Accepted'].includes(status); }

  function renderApplication(app, allApplications) {
    const payload = app?.payload || {};
    const status = app?.status || 'Not started';
    const withdrawn = app?.status === 'Withdrawn';
    const ref = withdrawn ? '—' : (app?.application_ref || '—');
    $('applicationStatus').textContent = status;
    $('applicationRef').textContent = ref;
    $('currentApplicationId').value = app?.id || '';
    $('quickbooksStatus').textContent = status;
    $('detailStatus').textContent = status;
    $('detailReference').textContent = ref;
    $('detailProgram').textContent = payload.course || '—';
    $('detailMode').textContent = payload.mode || '—';
    $('detailCohort').textContent = payload.cohort || '—';
    $('detailSubmitted').textContent = formatDate(app?.submitted_at);
    $('detailUpdated').textContent = formatDate(app?.updated_at || app?.submitted_at);
    $('detailSchedule').textContent = payload.schedule || '—';
    $('detailFullName').textContent = payload.name || app?.full_name || '—';
    $('detailEmail').textContent = payload.email || app?.email || '—';
    $('detailPhone').textContent = payload.phone || '—';
    $('detailCountry').textContent = payload.country || '—';

    const empty = $('applicationEmpty');
    if (app) {
      empty.hidden = true;
      $('applicationNote').textContent = withdrawn
        ? 'This application has been withdrawn. There is no active application on your account.'
        : 'Your application is securely linked to this account. SIFA can update its status during review.';
    } else {
      empty.hidden = false;
      $('applicationNote').textContent = 'You have not submitted an application. Admissions are currently closed.';
    }

    const withdrawBtn = $('withdrawApplicationBtn');
    if (withdrawBtn) withdrawBtn.hidden = !(app && app.source !== 'public' && activeApplicationStatus(status));

    const history = $('applicationHistory');
    history.innerHTML = '';
    if (allApplications && allApplications.length > 1) {
      const heading = document.createElement('div');
      heading.innerHTML = '<strong style="color:#071a33">Application history</strong>';
      history.appendChild(heading);
      allApplications.slice(1).forEach(item => {
        const row = document.createElement('div'); row.className='history-item';
        const refText = document.createElement('strong'); refText.textContent=item.application_ref || 'Application';
        const meta=document.createElement('span'); meta.style='color:#62748a;font-size:13px'; meta.textContent=`${item.payload?.course || 'Program'} · ${item.status || 'Submitted'} · ${formatDate(item.submitted_at)}`;
        row.append(refText, document.createElement('br'), meta); history.appendChild(row);
      });
    }

    const open = window.SIFA_SETTINGS?.applicationsOpen === true && getOpenPrograms().includes('QuickBooks Practical Training');
    const hasActiveApplication = !!app && activeApplicationStatus(status) && payload.course === 'QuickBooks Practical Training';
    const btn = $('applyPortalBtn');
    if (hasActiveApplication) {
      btn.textContent = 'View My Application'; btn.href='#my-application'; btn.onclick=(e)=>{e.preventDefault(); $('my-application')?.scrollIntoView({behavior:'smooth',block:'start'});};
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
    $('studentName').textContent=name; $('studentEmail').textContent=user.email || '';
    $('accountEmail').textContent=user.email || '—'; $('accountStatus').textContent='Active';
    $('emailStatus').textContent=user.email_confirmed_at ? 'Confirmed' : 'Not confirmed';
    $('memberSince').textContent=formatDate(user.created_at);
    $('profileName').value=name; $('profilePhone').value=profile?.phone || ''; $('profileCountry').value=profile?.country || '';
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
        status.textContent = 'No enrollment has been issued to your account yet. An accepted application does not automatically create an active enrollment.';
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
        return null;
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
          body: JSON.stringify({ action: 'whoami' })
        }
      );

      // Ordinary students do not have a staff role.
      if (response.status === 403) {
        return null;
      }

      if (!response.ok) {
        console.warn('SIFA staff-role check is unavailable.');
        return null;
      }

      const result = await response.json();

      if (
        result.active === true &&
        ['administrator', 'coordinator', 'finance_reviewer'].includes(result.role)
      ) {
        return result.role;
      }

      return null;
    } catch (error) {
      console.warn('SIFA staff-role check failed:', error);
      return null;
    }
  }

  async function loadUser(user, noticeText) {
    if (!user) return showLogin();
    currentUser=user;
    const [{data:profile},{data:applications,error:appError},{data:publicApplications,error:publicAppError}]=await Promise.all([
      supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(),
      supabase.from('applications').select('id,application_ref,status,submitted_at,updated_at,payload,created_at,full_name,email').eq('user_id',user.id).order('created_at',{ascending:false}),
      supabase.from('sifa_public_applications').select('id,application_ref,status,submitted_at,updated_at,payload,full_name,email,program').eq('linked_user_id',user.id).order('submitted_at',{ascending:false})
    ]);
    if(appError) console.error('Application load error:',appError);
    if(publicAppError) console.warn('Public application load skipped (backend migration may not yet be deployed):',publicAppError.message);
    const mappedPublic=(publicApplications||[]).map(a=>({...a,source:'public',created_at:a.submitted_at,payload:{...(a.payload||{}),course:a.program}}));
    const merged=[...(applications||[]),...mappedPublic].sort((a,b)=>new Date(b.created_at||b.submitted_at||0)-new Date(a.created_at||a.submitted_at||0));
    
    showDashboard(user, profile || {}, merged);
    void loadEnrollments(user.id);

    // Remove any staff link left from a previous account.
    document.getElementById('sifaStaffConsoleLink')?.remove();

    // Ask the protected backend whether this user is SIFA staff.
    const staffRole = await checkStaffRole();

    if (staffRole && currentUser?.id === user.id) {
      const staffLink = document.createElement('a');

      staffLink.id = 'sifaStaffConsoleLink';
      staffLink.href = 'sifa-admin.html';
      staffLink.textContent = 'Open SIFA Staff Console';

      staffLink.style.display = 'inline-block';
      staffLink.style.margin = '16px 0';
      staffLink.style.padding = '12px 20px';
      staffLink.style.backgroundColor = '#071a33';
      staffLink.style.color = '#ffffff';
      staffLink.style.borderRadius = '8px';
      staffLink.style.textDecoration = 'none';
      staffLink.style.fontWeight = 'bold';

      dashboard.prepend(staffLink);
    }

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
      emailRedirectTo: `${location.origin}/student-portal.html?confirmed=true`
    }
  });

  
if (error) {
  console.error('SIFA account registration failed:', error);
  return showMessage(
    'We could not create your account. Please check your details and try again. If the problem continues, contact SIFA support.',
    'error'
  );
}

  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        full_name: name,
        email: email
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
    }
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
  $('profileForm')?.addEventListener('submit',async e=>{
    e.preventDefault();if(!currentUser)return;
    const btn=$('saveProfileBtn');btn.disabled=true;btn.textContent='Saving…';
    const full_name=$('profileName').value.trim(), phone=$('profilePhone').value.trim(), country=$('profileCountry').value.trim();
    if(full_name.length<2){btn.disabled=false;btn.textContent='Save Changes';return showMessage('Please enter your full name.','error');}
    const{data,error}=await supabase.from('profiles').upsert({id:currentUser.id,full_name,email:currentUser.email||'',phone,country,updated_at:new Date().toISOString()}).select('*').single();
    btn.disabled=false;btn.textContent='Save Changes';
    if(error)return showMessage(error.message,'error');
    renderProfile(currentUser,data);showMessage('Your account information has been updated.','success');
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

  $('withdrawApplicationBtn')?.addEventListener('click',()=>{
    if(!currentUser)return;
    openModal({
      title:'Withdraw your application?',
      body:'SIFA will stop processing this application. Your application record will remain securely linked to your account with the status “Withdrawn”.',
      confirmLabel:'Withdraw Application', danger:true,
      onConfirm:async()=>{
        const btn=$('withdrawApplicationBtn');btn.disabled=true;btn.textContent='Withdrawing…';
        const{error}=await supabase.rpc('withdraw_my_application',{application_id:$('currentApplicationId').value});
        btn.disabled=false;btn.textContent='Withdraw Application';
        closeModal();
        if(error)return showMessage('We could not withdraw the application yet. Please make sure the SIFA Student Portal database setup has been completed.','error');
        await loadUser(currentUser,'Your application has been withdrawn successfully.');
      }
    });
  });

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
  $('logoutBtn')?.addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage('Could not log out. Please try again.', 'error');
    return;
  }

  currentUser = null;
  showLogin('You have been signed out.', 'success');
});

  supabase.auth.onAuthStateChange(async (event, session) => {
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

  history.replaceState({}, document.title, window.location.pathname);
}

  } else {
    showLogin();
  }
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
