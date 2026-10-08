(function () {
  const config = window.SIFA_SUPABASE_CONFIG || {};
  const ready = config.url && config.anonKey && !String(config.url).includes('YOUR_SUPABASE');
  const $ = (id) => document.getElementById(id);
  const loginPanel = $('loginPanel'), signupPanel = $('signupPanel'), dashboard = $('studentDashboard');
  const message = $('portalMessage');
  let supabase = null;
  let currentUser = null;
  let bootComplete = false;
  let pendingConfirm = null;

  function showMessage(text, type='info') {
    if (!message) return;
    message.textContent = text;
    message.className = 'portal-message ' + type;
    message.hidden = false;
    // Do not scroll the page. Action feedback should not move the student away from the control they used.
  }
  function hideMessage(){ if(message) message.hidden = true; }
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
    if (withdrawBtn) withdrawBtn.hidden = !(app && activeApplicationStatus(status));

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

  async function loadUser(user, noticeText) {
    if (!user) return showLogin();
    currentUser=user;
    const [{data:profile},{data:applications,error:appError}]=await Promise.all([
      supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(),
      supabase.from('applications').select('id,application_ref,status,submitted_at,updated_at,payload,created_at,full_name,email').eq('user_id',user.id).order('created_at',{ascending:false})
    ]);
    if(appError) console.error('Application load error:',appError);
    showDashboard(user,profile||{},applications||[]);
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
  supabase=window.supabase.createClient(config.url,config.anonKey);

  $('showSignup')?.addEventListener('click',e=>{e.preventDefault();showSignup();});
  $('showLogin')?.addEventListener('click',e=>{e.preventDefault();showLogin();});
  $('forgotPassword')?.addEventListener('click',async e=>{
    e.preventDefault();
    const email=$('loginEmail').value.trim();
    if(!email)return showMessage('Enter your email address first.','error');
    const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(error)return showMessage(error.message,'error');
    showMessage('Password reset instructions have been sent to your email. Open the link in that email to set a new password.','success');
  });
  $('loginForm')?.addEventListener('submit',async e=>{
    e.preventDefault();hideMessage();
    const email=$('loginEmail').value.trim(), password=$('loginPassword').value;
    const{data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error)return showMessage(error.message,'error');
    await loadUser(data.user);
  });
  $('signupForm')?.addEventListener('submit',async e=>{
    e.preventDefault();hideMessage();
    const name=$('signupName').value.trim(), email=$('signupEmail').value.trim(), password=$('signupPassword').value, confirm=$('signupConfirm').value;
    if(name.length<2)return showMessage('Please enter your full name.','error');
    if(password.length<8)return showMessage('Your password must contain at least 8 characters.','error');
    if(password!==confirm)return showMessage('The two passwords do not match.','error');
    const{data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});
    if(error)return showMessage(error.message,'error');
    if(data.user)await supabase.from('profiles').upsert({id:data.user.id,full_name:name,email});
    if(!data.session)showLogin('Your account has been created. Please check your email to verify your account, then sign in.','success');
    else await loadUser(data.user);
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
    closePasswordPanel();showMessage('Your password has been changed successfully.','success');
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
  $('logoutBtn')?.addEventListener('click',async()=>{await supabase.auth.signOut();currentUser=null;showLogin('You have been signed out.','success');});

  supabase.auth.onAuthStateChange((_event,session)=>{
    if(_event==='PASSWORD_RECOVERY' && session?.user){
      currentUser=session.user;
      loadUser(session.user).then(()=>openPasswordPanel(true));
      return;
    }
    if(!bootComplete)return;
    if(session?.user)loadUser(session.user);else showLogin();
  });
  supabase.auth.getSession().then(({data})=>{
    bootComplete=true;
    if(data.session?.user)loadUser(data.session.user);else showLogin();
  });
})();
