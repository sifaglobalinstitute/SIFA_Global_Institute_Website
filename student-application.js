(function () {
  const config = window.SIFA_SUPABASE_CONFIG || {};
  const ready = config.url && config.anonKey && !String(config.url).includes('YOUR_SUPABASE');
  const form = document.getElementById('applicationForm');
  if (!form) return;

  const QUICKBOOKS = 'QuickBooks Practical Training';
  const openPrograms = () => Array.isArray(window.SIFA_SETTINGS?.openPrograms) ? window.SIFA_SETTINGS.openPrograms : [];

  function notice(text, type='error') {
    let box = document.getElementById('studentAuthNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'studentAuthNotice';
      box.style.cssText = 'margin:0 32px 24px;padding:16px 18px;border-radius:12px;border:1px solid #efcaca;background:#fff5f5;color:#8a2d2d;font-weight:600;';
      form.parentElement.insertBefore(box, form);
    }
    box.textContent = text;
    box.style.background = type === 'success' ? '#f1faf5' : type === 'warning' ? '#fff9ed' : '#fff5f5';
    box.style.borderColor = type === 'success' ? '#bfe2cc' : type === 'warning' ? '#ecd59e' : '#efcaca';
    box.style.color = type === 'success' ? '#1d6a3d' : type === 'warning' ? '#70551a' : '#8a2d2d';
    box.scrollIntoView({behavior:'smooth', block:'center'});
  }

  if (!ready) {
    form.addEventListener('submit', e => {
      e.preventDefault(); e.stopImmediatePropagation();
      notice('Student Portal is not connected yet. Please complete the Supabase setup before accepting applications.', 'error');
    }, true);
    return;
  }

  const supabase = window.supabase.createClient(config.url, config.anonKey);

  const successStyle = document.createElement('style');
  successStyle.textContent = `
    .application-success-card{max-width:820px;margin:10px auto 40px;padding:46px 38px;background:#fff;border:1px solid #dfe7ef;border-radius:22px;box-shadow:0 18px 45px rgba(6,42,82,.10);text-align:center}
    .application-success-card .success-icon{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:#dff5e7;color:#19733f;font-size:34px;font-weight:900}
    .application-success-card .success-eyebrow{background:#edf8f1;border-color:#cfe7d8;color:#19733f}
    .application-success-card h2{margin:18px 0 12px;color:#071a33}
    .application-success-card p{max-width:650px;margin:0 auto 14px;color:#526579;line-height:1.75}
    .success-reference{max-width:460px;margin:24px auto 16px;padding:17px 20px;background:#f7fafc;border:1px solid #dfe7ef;border-radius:14px}
    .success-reference span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:#6a7b8c;margin-bottom:6px}
    .success-reference strong{display:block;color:#071a33;font-size:20px;letter-spacing:.04em;word-break:break-word}
    .success-note{font-size:14px!important}
    .success-actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:24px}
    .success-secondary{color:#071a33!important;border-color:#cfdbe5!important;background:#fff!important}
    @media(max-width:560px){.application-success-card{padding:34px 20px}.success-reference strong{font-size:17px}}
    .success-submitted-info{max-width:650px;margin:24px auto 0;text-align:left;padding-top:22px;border-top:1px solid #e5ebf0}.success-submitted-info h3{margin:0 0 12px;color:#071a33}.success-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.success-info-grid>div{padding:12px 14px;background:#f7fafc;border:1px solid #e5ebf0;border-radius:10px}.success-info-grid span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;color:#6a7b8c;margin-bottom:4px}.success-info-grid strong{display:block;color:#203247;word-break:break-word}@media(max-width:560px){.success-info-grid{grid-template-columns:1fr}}

  `;
  document.head.appendChild(successStyle);


  function safeValue(name) {
    const el = form.elements.namedItem(name);
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  function fillStudentIdentity(user) {
    const nameField = form.elements.namedItem('name');
    const emailField = form.elements.namedItem('email');
    const name = user.user_metadata?.full_name || '';
    if (nameField && name) { nameField.value = name; nameField.readOnly = true; }
    if (emailField && user.email) { emailField.value = user.email; emailField.readOnly = true; }
  }

  async function uploadDocuments(userId, applicationId) {
    const paths = [];
    const files = Array.from(form.querySelectorAll('input[type="file"]'));
    for (const input of files) {
      for (const file of Array.from(input.files || [])) {
        if (!file || file.size === 0) continue;
        if (file.size > 10 * 1024 * 1024) throw new Error(`The file "${file.name}" is larger than 10 MB.`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${userId}/${applicationId}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from('student-documents').upload(path, file, { upsert: false });
        if (error) throw error;
        paths.push(path);
      }
    }
    return paths;
  }

  async function cleanupDocuments(paths) {
    if (!paths.length) return;
    try { await supabase.storage.from('student-documents').remove(paths); } catch (e) { console.warn('Document cleanup failed:', e); }
  }

  async function ensureAuthenticated() {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return null;
    fillStudentIdentity(user);
    return user;
  }

  function showSubmissionConfirmation(applicationRef) {
    form.style.display = 'none';
    const summary = {
      name: safeValue('name') || '—',
      email: safeValue('email') || '—',
      phone: safeValue('phone') || '—',
      country: safeValue('country') || '—',
      program: safeValue('course') || '—',
      mode: safeValue('mode') || '—',
      cohort: safeValue('cohort') || '—'
    };
    const old = document.getElementById('applicationSuccessCard');
    if (old) old.remove();
    const card = document.createElement('section');
    card.id = 'applicationSuccessCard';
    card.className = 'application-success-card';
    card.innerHTML = `
      <div class="success-icon" aria-hidden="true">✓</div>
      <span class="eyebrow success-eyebrow">Application received</span>
      <h2>Application submitted successfully</h2>
      <p>Thank you for applying to SIFA Global Institute. Your application and supporting documents have been received and are now linked to your student account.</p>
      <div class="success-reference"><span>Application reference</span><strong>${applicationRef}</strong></div>
      <div class="success-submitted-info">
        <h3>Submitted information</h3>
        <div class="success-info-grid">
          <div><span>Full name</span><strong>${summary.name}</strong></div>
          <div><span>Email</span><strong>${summary.email}</strong></div>
          <div><span>Phone</span><strong>${summary.phone}</strong></div>
          <div><span>Country</span><strong>${summary.country}</strong></div>
          <div><span>Program</span><strong>${summary.program}</strong></div>
          <div><span>Learning mode</span><strong>${summary.mode}</strong></div>
          <div><span>Cohort</span><strong>${summary.cohort}</strong></div>
        </div>
      </div>
      <p class="success-note">Keep this reference for your records. You can return to your Student Portal at any time to follow your application status and submitted information.</p>
      <div class="success-actions">
        <a class="btn btn-primary" href="student-portal.html?submitted=1">Go to Student Portal</a>
        <a class="btn btn-secondary success-secondary" href="courses.html">View Courses</a>
      </div>`;
    form.parentElement.insertBefore(card, form);
    card.scrollIntoView({behavior:'smooth', block:'start'});
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (window.SIFA_SETTINGS?.applicationsOpen !== true) {
      notice('Applications are currently closed. Your Student Portal account remains active, but SIFA is not accepting application submissions at this time.', 'warning');
      return;
    }

    const selectedCourse = safeValue('course');
    if (!openPrograms().includes(selectedCourse) || selectedCourse !== QUICKBOOKS) {
      notice('At the moment, only QuickBooks Practical Training is open for application. Other programs are not accepting applications.', 'warning');
      return;
    }

    const user = await ensureAuthenticated();
    if (!user) {
      notice('Please create or sign in to your SIFA Student Portal first. Redirecting you to the secure portal…');
      setTimeout(() => { location.href = 'student-portal.html?next=apply.html'; }, 900);
      return;
    }

    const { data: existing } = await supabase.from('applications').select('application_ref,status,payload,submitted_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing && ['Submitted','Under Review','Needs Information','Accepted'].includes(existing.status) && existing.payload?.course === QUICKBOOKS) {
      notice(`You already have a QuickBooks application (${existing.application_ref}) with status "${existing.status}". Please use your Student Portal to follow its progress.`, 'warning');
      setTimeout(() => { location.href = 'student-portal.html'; }, 1800);
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting securely…'; }
    let documentPaths = [];
    try {
      const applicationId = crypto.randomUUID();
      const applicationRef = `SIFA-${new Date().getFullYear()}-${applicationId.slice(0,8).toUpperCase()}`;
      const data = {};
      new FormData(form).forEach((value, key) => {
        if (value instanceof File) return;
        if (key === 'accuracy' || key === 'contactConsent') data[key] = value === 'on' ? true : value;
        else if (key !== '_subject') data[key] = value;
      });
      data.user_id = user.id;
      data.email = user.email || safeValue('email');
      data.account_email = user.email || '';
      data.submitted_from_portal = true;
      data.admission_program = QUICKBOOKS;

      documentPaths = await uploadDocuments(user.id, applicationId);
      const { error } = await supabase.from('applications').insert({
        id: applicationId,
        application_ref: applicationRef,
        user_id: user.id,
        status: 'Submitted',
        full_name: safeValue('name') || user.user_metadata?.full_name || 'Student',
        email: user.email || safeValue('email'),
        payload: data,
        document_paths: documentPaths
      });
      if (error) throw error;

      await supabase.from('profiles').upsert({
        id: user.id,
        full_name: safeValue('name') || user.user_metadata?.full_name || '',
        email: user.email || safeValue('email'),
        phone: safeValue('phone'),
        country: safeValue('country'),
        updated_at: new Date().toISOString()
      });

      form.reset();
      showSubmissionConfirmation(applicationRef);
    } catch (err) {
      console.error(err);
      await cleanupDocuments(documentPaths);
      notice(err?.message || 'We could not submit your application. Please try again or contact SIFA support.');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Application'; }
    }
  }, true);

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user;
    if (!user) {
      notice('A SIFA Student Portal account is required before applying. Redirecting you to the secure portal…');
      setTimeout(() => { location.href = 'student-portal.html?next=apply.html'; }, 900);
    } else {
      fillStudentIdentity(user);
      const course = form.elements.namedItem('course');
      if (course) {
        course.value = QUICKBOOKS;
        course.disabled = false;
      }
    }
  });
})();
